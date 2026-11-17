// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { ApiGatewayToDynamoDB } from '@aws-solutions-constructs/aws-apigateway-dynamodb'
import { CfnResource, Duration, Stack, StackProps } from 'aws-cdk-lib'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import { AwsDynamoDBKinesisStreamsS3, suppressCdkNag, suppressCheckov } from 'aws-dynamodb-kinesisstreams-s3/lib'
import { Construct } from 'constructs'
import * as path from 'path'

const compliancePacks = ['HIPAA.Security', 'NIST.800.53.R5', 'PCI.DSS.321']

export class AwsServerlessDynamoDbS3IngestionStack extends Stack {
  public readonly dynamodbKinesisS3: AwsDynamoDBKinesisStreamsS3;
  public readonly apiGatewayToDynamoDB: ApiGatewayToDynamoDB;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
    const modelName = 'SourceData'

    // Create the DynamoDB table integrated with Kinesis and S3
    this.dynamodbKinesisS3 = new AwsDynamoDBKinesisStreamsS3(this, 'dynamodbKinesisS3', {
      applyTransformation: true,
      transformationFunctionProps: {
        code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda')),
        runtime: lambda.Runtime.NODEJS_24_X,
        handler: 'index.handler',
        timeout: Duration.minutes(1),
        // Bound the blast radius of the transformation function
        reservedConcurrentExecutions: 10
      },
      dynamoTableProps: {
        partitionKey: {
          name: `${modelName}Id`,
          type: dynamodb.AttributeType.STRING
        }
      }
    })

    // Create the API integrated with the existing DynamoDB table.
    // The API uses AWS_IAM authorization (Solutions Constructs default); callers must sign requests with SigV4.
    // CORS is intentionally not enabled: the API is not meant to be called from browsers.
    // The endpoint is public (EDGE) so the sample can be exercised from anywhere with IAM credentials; for
    // workloads that only call it from inside a VPC, set endpointConfiguration to PRIVATE.
    this.apiGatewayToDynamoDB = new ApiGatewayToDynamoDB(this, modelName, {
      existingTableObj: this.dynamodbKinesisS3.dynamoTable,
      allowCreateOperation: true,
      allowReadOperation: true,
      apiGatewayProps: {
        restApiName: `${modelName} Service`,
        // Execution logs at ERROR only; INFO would log request details for every call
        deployOptions: { loggingLevel: apigateway.MethodLoggingLevel.ERROR }
      },
      logGroupProps: {
        retention: logs.RetentionDays.ONE_YEAR,
        encryptionKey: this.dynamodbKinesisS3.encryptionKey
      },
      createRequestTemplate: `{
        "Item": {
          "${modelName}Id": {
            "S": "$context.requestId"
          },
          "MessageData":{
            "S": "$input.path('$.data')"
          }
        },
        "TableName": "${this.dynamodbKinesisS3.dynamoTable.tableName}"
      }`
    })

    // The table is encrypted with a customer managed key. ApiGatewayToDynamoDB only grants
    // dynamodb:PutItem/Query on an existing table, so its role also needs to use the key.
    this.dynamodbKinesisS3.encryptionKey.grantEncryptDecrypt(this.apiGatewayToDynamoDB.apiGatewayRole)

    this.addRequestValidation(modelName)
    this.addScannerSuppressions()
  }

  /**
   * Reject malformed requests at API Gateway before they reach DynamoDB:
   * POST bodies must be a JSON object with a single string "data" field; GET must carry the path id.
   */
  private addRequestValidation (modelName: string): void {
    const api = this.apiGatewayToDynamoDB.apiGateway
    const validator = api.addRequestValidator('RequestValidator', {
      validateRequestBody: true,
      validateRequestParameters: true
    })
    const inputModel = api.addModel(`${modelName}Input`, {
      contentType: 'application/json',
      schema: {
        schema: apigateway.JsonSchemaVersion.DRAFT4,
        title: `${modelName}Input`,
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: { type: apigateway.JsonSchemaType.STRING, minLength: 1, maxLength: 10000 }
        }
      }
    })

    for (const method of api.methods) {
      const cfn = method.node.defaultChild as apigateway.CfnMethod
      cfn.requestValidatorId = validator.requestValidatorId
      if (method.httpMethod === 'POST') {
        cfn.requestModels = { 'application/json': inputModel.modelId }
      } else if (method.httpMethod === 'GET') {
        cfn.requestParameters = { [`method.request.path.${modelName}Id`]: true }
      }
    }
  }

  /** Documented scanner suppressions for rules that do not apply to this sample's API. */
  private addScannerSuppressions (): void {
    const api = this.apiGatewayToDynamoDB.apiGateway
    const stage = api.deploymentStage.node.defaultChild as CfnResource

    suppressCheckov(stage, [
      { id: 'CKV_AWS_120', comment: 'Write-oriented ingestion API; response caching would return stale reads and adds cost without security benefit.' }
    ])
    suppressCdkNag(stage, [
      { id: 'AwsSolutions-APIG3', reason: 'AWS WAF is a cost and threat-model decision for each deployment; every request already requires SigV4 IAM authorization.' },
      ...['NIST.800.53.R5', 'PCI.DSS.321'].map((pack) => ({
        id: `${pack}-APIGWAssociatedWithWAF`, reason: 'AWS WAF is a cost and threat-model decision for each deployment; every request already requires SigV4 IAM authorization.'
      })),
      ...compliancePacks.map((pack) => ({
        id: `${pack}-APIGWCacheEnabledAndEncrypted`, reason: 'Caching is disabled by design: a write-oriented ingestion API would return stale reads.'
      })),
      ...compliancePacks.map((pack) => ({
        id: `${pack}-APIGWSSLEnabled`, reason: 'Backend client certificates apply to HTTP integrations; this API integrates directly with DynamoDB over the AWS service endpoint (HTTPS, SigV4).'
      }))
    ])

    for (const method of api.methods) {
      suppressCdkNag(method.node.defaultChild as CfnResource, [
        { id: 'AwsSolutions-COG4', reason: 'Methods use AWS_IAM (SigV4) authorization, which suits service-to-service callers; a Cognito user pool is for end-user sign-in.' }
      ])
    }

    for (const child of this.apiGatewayToDynamoDB.node.findAll()) {
      if (CfnResource.isCfnResource(child) && ['AWS::IAM::Role', 'AWS::IAM::Policy'].includes(child.cfnResourceType)) {
        suppressCdkNag(child, [
          {
            id: 'AwsSolutions-IAM5',
            reason: 'KMS action families come from the CDK grantEncryptDecrypt call and are scoped to the single customer managed key that encrypts the table. See https://docs.aws.amazon.com/kms/latest/developerguide/kms-api-permissions-reference.html',
            appliesTo: ['Action::kms:GenerateDataKey*', 'Action::kms:ReEncrypt*']
          },
          {
            id: 'AwsSolutions-IAM5',
            reason: 'API Gateway account-level CloudWatch role: the service writes execution logs to log groups it names per API and stage, so AWS requires logs permissions across the account and Region. See https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-logging.html',
            appliesTo: ['Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:*']
          },
          ...compliancePacks.map((pack) => ({
            id: `${pack}-IAMNoInlinePolicy`,
            reason: 'Policies are created by CDK grant methods and AWS Solutions Constructs as inline policies scoped to this stack\'s resources. See https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-vs-inline.html'
          }))
        ])
      }
    }
  }
}

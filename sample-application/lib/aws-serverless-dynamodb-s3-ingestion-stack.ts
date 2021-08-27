// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as dynamodb from '@aws-cdk/aws-dynamodb'
import * as cdk from '@aws-cdk/core'
import { Duration } from '@aws-cdk/core'
import * as lambda from '@aws-cdk/aws-lambda'
import * as apigateway from '@aws-cdk/aws-apigateway'
import * as path from 'path'
import { ApiGatewayToDynamoDB } from '@aws-solutions-constructs/aws-apigateway-dynamodb'
import { AwsDynamoDBKinesisStreamsS3 } from 'aws-dynamodb-kinesisstreams-s3/lib'

export class AwsServerlessDynamoDbS3IngestionStack extends cdk.Stack {
  public readonly dynamodbKinesisS3: AwsDynamoDBKinesisStreamsS3;
  public readonly apiGatewayToDynamoDB: ApiGatewayToDynamoDB;

  constructor (scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)
    const modelName = 'SourceData'

    // Create the DynamoDB table integrated with Kinesis and S3
    this.dynamodbKinesisS3 = new AwsDynamoDBKinesisStreamsS3(this, 'dynamodbKinesisS3', {
      applyTransformation: true,
      transformationFunctionProps: {
        code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda')),
        runtime: lambda.Runtime.NODEJS_12_X,
        handler: 'index.handler',
        timeout: Duration.minutes(15)
      },
      dynamoTableProps: {
        partitionKey: {
          name: `${modelName}Id`,
          type: dynamodb.AttributeType.STRING
        }
      }
    })

    // Create the API integrated with the existing DynamoDB table
    this.apiGatewayToDynamoDB = new ApiGatewayToDynamoDB(this, modelName, {
      existingTableObj: this.dynamodbKinesisS3.dynamoTable,
      allowCreateOperation: true,
      allowReadOperation: true,
      apiGatewayProps: {
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS
        },
        restApiName: `${modelName} Service`
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
  }
}

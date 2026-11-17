// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { KinesisStreamsToKinesisFirehoseToS3, KinesisStreamsToKinesisFirehoseToS3Props } from '@aws-solutions-constructs/aws-kinesisstreams-kinesisfirehose-s3'
import * as defaults from '@aws-solutions-constructs/core'
import { ArnFormat, CfnResource, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'

export interface AwsDynamoDBKinesisStreamsS3Props {

  /**
   * Optional flag that determines if a transformation lambda function will be added to Kinesis Firehose.
   *
   * @default - false
   */
  readonly applyTransformation?: boolean;

  /**
   * Optional existing instance of a Transformation Lambda Function to be called by Kinesis Data Firehose,
   * providing both this and `lambdaFunctionProps` will cause an error.
   *
   * Note: This field is only utilized when applyTransformation is true.
   *
   * @default - None
   */
  readonly existingTransformationLambdaObj?: lambda.Function;

  /**
   * Optional user provided props to override the default props for the Transformation Lambda function.
   *
   * Note: This field is only utilized when applyTransformation is true.
   *
   * @default - Default props are used
   */
  readonly transformationFunctionProps?: lambda.FunctionProps;

  /**
   * Optional user provided props to override the default props utilized to create the source DynamoDB table
   *
   * @default - Default props are used
   */
  readonly dynamoTableProps?: dynamodb.TableProps;

  /**
   * Optional user provided props to override the default props utilized to create the target S3 Bucket.
   *
   * @default - Default props are used
   */
  readonly bucketProps?: s3.BucketProps;

  /**
   * Optional existing customer managed KMS key used to encrypt the DynamoDB table and
   * the Firehose CloudWatch log group. If not provided, a new key with rotation enabled is created.
   *
   * @default - A new customer managed KMS key is created
   */
  readonly encryptionKey?: kms.IKey;

  /**
   * Retention period for the CloudWatch log groups created by this construct.
   *
   * @default - logs.RetentionDays.ONE_YEAR
   */
  readonly logRetention?: logs.RetentionDays;
}

/**
 * Default DynamoDB table properties used in case no user provided value is present
 */
const defaultTableProps: dynamodb.TableProps = {
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
  partitionKey: {
    name: 'id',
    type: dynamodb.AttributeType.STRING
  }
}

/**
 * Allows CloudWatch Logs in this account and Region to use the key for log groups in this account.
 * See https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/encrypt-log-data-kms.html
 *
 * Why the wildcards are needed:
 * - Action families (kms:Encrypt*, kms:Decrypt*, kms:ReEncrypt*, kms:GenerateDataKey*, kms:Describe*) are the
 *   exact set the CloudWatch Logs documentation above requires for encrypting log data.
 * - Resource '*' is the only valid value in a key policy: it means "this key", not every key.
 * Scope is limited by the conditions: the request must come from this account (aws:SourceAccount) and carry an
 * encryption context naming a log group in this account and Region.
 */
export function grantCloudWatchLogsKeyUsage (key: kms.IKey, scope: Construct): void {
  const stack = Stack.of(scope)
  key.addToResourcePolicy(new iam.PolicyStatement({
    sid: 'AllowCloudWatchLogsUse',
    principals: [new iam.ServicePrincipal(`logs.${stack.region}.amazonaws.com`)],
    actions: ['kms:Encrypt*', 'kms:Decrypt*', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:Describe*'],
    resources: ['*'],
    conditions: {
      StringEquals: {
        'aws:SourceAccount': stack.account
      },
      ArnLike: {
        'kms:EncryptionContext:aws:logs:arn': stack.formatArn({
          service: 'logs',
          resource: 'log-group',
          resourceName: '*',
          arnFormat: ArnFormat.COLON_RESOURCE_NAME
        })
      }
    }
  }))
}

/**
 * A cdk-nag rule suppression. `appliesTo` narrows an IAM5-style finding to the exact wildcard it covers:
 * either the literal finding string or `{ regex: '/.../g' }`, as cdk-nag accepts.
 */
export interface CdkNagSuppression {
  readonly id: string;
  readonly reason: string;
  readonly appliesTo?: (string | { regex: string })[];
}

/**
 * Adds documented cdk-nag suppressions as CloudFormation metadata, so they apply without a cdk-nag
 * dependency and are honoured both by the cdk-nag Aspect and by template-based scanners.
 */
export function suppressCdkNag (resource: CfnResource, rules: CdkNagSuppression[]): void {
  const existing = (resource.getMetadata('cdk_nag') as { rules_to_suppress?: object[] }) ?? {}
  resource.addMetadata('cdk_nag', {
    rules_to_suppress: [
      ...(existing.rules_to_suppress ?? []),
      ...rules.map((r) => ({ id: r.id, reason: r.reason, ...(r.appliesTo ? { applies_to: r.appliesTo } : {}) }))
    ]
  })
}

/** Compliance-pack rule ids share a suffix; expand one suffix into every pack that defines it. */
function compliancePackIds (rule: string, packs: string[] = ['HIPAA.Security', 'NIST.800.53.R5', 'PCI.DSS.321']): string[] {
  return packs.map((pack) => `${pack}-${rule}`)
}

/**
 * Wildcards that AWS service integrations used by this construct require, with the reason for each.
 * Applied to every IAM role and policy the construct creates.
 */
function iamWildcardSuppressions (): CdkNagSuppression[] {
  return [
    {
      id: 'AwsSolutions-IAM5',
      reason: 'KMS action families come from CDK key grants (grantEncryptDecrypt / grantWrite) and are scoped to the single customer managed key created for this pipeline. See https://docs.aws.amazon.com/kms/latest/developerguide/kms-api-permissions-reference.html',
      appliesTo: ['Action::kms:GenerateDataKey*', 'Action::kms:ReEncrypt*']
    },
    {
      id: 'AwsSolutions-IAM5',
      reason: 'X-Ray PutTraceSegments and PutTelemetryRecords do not support resource-level permissions, so AWS requires Resource "*". See https://docs.aws.amazon.com/xray/latest/devguide/security_iam_service-with-iam.html',
      appliesTo: ['Resource::*']
    },
    {
      id: 'AwsSolutions-IAM5',
      reason: 'Firehose invokes the transformation function by version/alias; the ":*" suffix covers versions of this one function only. See https://docs.aws.amazon.com/lambda/latest/dg/lambda-api-permissions-ref.html',
      appliesTo: [{ regex: '/^Resource::<.*LambdaFunction.*\\.Arn>:\\*$/g' }]
    },
    {
      id: 'AwsSolutions-IAM5',
      reason: 'Firehose writes objects under date-partitioned keys; the "/*" suffix covers objects in this pipeline\'s own data bucket only. See https://docs.aws.amazon.com/firehose/latest/dev/controlling-access.html',
      appliesTo: [{ regex: '/^Resource::<.*S3Bucket.*\\.Arn>\\/\\*$/g' }]
    },

    ...compliancePackIds('IAMNoInlinePolicy').map((id) => ({
      id,
      reason: 'Policies are created by CDK grant methods as inline policies scoped to this stack\'s resources; managed policies would add no isolation for single-purpose service roles. See https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-vs-inline.html'
    }))
  ]
}

/** Apply suppressions to every CloudFormation resource of the given types under `scope`. */
function suppressCdkNagByType (scope: Construct, types: string[], rules: CdkNagSuppression[]): void {
  for (const child of scope.node.findAll()) {
    if (CfnResource.isCfnResource(child) && types.includes(child.cfnResourceType)) {
      suppressCdkNag(child, rules)
    }
  }
}

/**
 * Adds a documented checkov suppression to the underlying CloudFormation resource.
 */
export function suppressCheckov (resource: CfnResource, rules: { id: string, comment: string }[]): void {
  const existing = (resource.getMetadata('checkov') as { skip?: { id: string, comment: string }[] }) ?? {}
  resource.addMetadata('checkov', { skip: [...(existing.skip ?? []), ...rules] })
}

/**
 * Adds cfn-guard rule suppressions to the underlying CloudFormation resource.
 * cfn-guard metadata has no comment field, so justifications live next to each call site.
 */
export function suppressGuard (resource: CfnResource, ruleIds: string[]): void {
  const existing = (resource.getMetadata('guard') as { SuppressedRules?: string[] }) ?? {}
  resource.addMetadata('guard', { SuppressedRules: [...(existing.SuppressedRules ?? []), ...ruleIds] })
}

/**
 * CDK renders the enforce-SSL condition as the string "false". IAM treats it the same as the boolean,
 * but policy scanners (cfn-guard S3_BUCKET_SSL_REQUESTS_ONLY) require the boolean form, so emit that.
 */
function emitBooleanSecureTransport (bucket: s3.IBucket | undefined): void {
  const policy = bucket?.policy
  if (!policy) {
    return
  }
  const doc = Stack.of(policy).resolve(policy.document.toJSON()) as { Statement?: { Condition?: { Bool?: Record<string, unknown> } }[] }
  doc.Statement?.forEach((statement, index) => {
    if (statement.Condition?.Bool?.['aws:SecureTransport'] === 'false') {
      (policy.node.defaultChild as CfnResource).addPropertyOverride(
        `PolicyDocument.Statement.${index}.Condition.Bool.aws:SecureTransport`, false)
    }
  })
}

/**
 * Default bucket hardening applied to the data and access-log buckets: ACLs disabled and private.
 */
const hardenedBucketDefaults: s3.BucketProps = {
  objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
  accessControl: s3.BucketAccessControl.PRIVATE
}

export class AwsDynamoDBKinesisStreamsS3 extends Construct {
  public readonly transformationLambda?: lambda.Function;
  public readonly dynamoTable: dynamodb.Table;
  public readonly kinesisStreamsToKinesisFirehoseToS3: KinesisStreamsToKinesisFirehoseToS3;
  public readonly encryptionKey: kms.IKey;
  /** Log group of the transformation Lambda, when this construct created it. */
  public readonly transformationLogGroup?: logs.LogGroup;

  /**
   * @summary Constructs a new instance of the AwsDynamodbKinesisStreamsS3 class.
   * @param {Construct} scope - represents the scope for all the resources.
   * @param {string} id - this is a a scope-unique id.
   * @param {AwsDynamoDBKinesisStreamsS3} props - user provided props for the construct.
   */

  constructor(scope: Construct, id: string, props: AwsDynamoDBKinesisStreamsS3Props) {
    super(scope, id)
    let firehoseProps: KinesisStreamsToKinesisFirehoseToS3Props = {}
    const logRetention = props.logRetention ?? logs.RetentionDays.ONE_YEAR

    // Customer managed key (with rotation) for the DynamoDB table and CloudWatch log groups
    this.encryptionKey = props.encryptionKey ?? new kms.Key(this, 'EncryptionKey', {
      description: 'Encrypts the DynamoDB source table and CloudWatch log groups for the ingestion pipeline',
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN
    })
    grantCloudWatchLogsKeyUsage(this.encryptionKey, this)

    if (props.applyTransformation) {
      // Without an explicit log group, Lambda creates one outside CloudFormation with no
      // retention and no encryption. Manage it here unless the caller supplied their own.
      let lambdaFunctionProps = props.transformationFunctionProps
      if (lambdaFunctionProps && !lambdaFunctionProps.logGroup) {
        this.transformationLogGroup = new logs.LogGroup(this, 'TransformationLogGroup', {
          retention: logRetention,
          encryptionKey: this.encryptionKey
        })
        lambdaFunctionProps = { ...lambdaFunctionProps, logGroup: this.transformationLogGroup }
      }

      // Create the lambda function that will transform the data. Built directly rather than with the
      // Solutions Constructs helper, whose role always carries logs permissions on every /aws/lambda/* log
      // group. This role starts empty: CDK adds X-Ray (tracing) and the explicit log-group grant below.
      // Construct ids match the helper's, so existing deployments update the function in place.
      if (props.existingTransformationLambdaObj) {
        this.transformationLambda = props.existingTransformationLambdaObj
      } else {
        if (!lambdaFunctionProps) {
          throw new Error('transformationFunctionProps or existingTransformationLambdaObj is required when applyTransformation is true')
        }
        const role = lambdaFunctionProps.role ?? new iam.Role(this, 'LambdaFunctionServiceRole', {
          assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
          description: 'Firehose record transformation function; permissions are added by explicit grants only'
        })
        this.transformationLambda = new lambda.Function(this, 'LambdaFunction', {
          tracing: lambda.Tracing.ACTIVE,
          ...lambdaFunctionProps,
          role
        })
        const cfnFunction = this.transformationLambda.node.defaultChild as CfnResource
        cfnFunction.addMetadata('cfn_nag', {
          rules_to_suppress: [
            { id: 'W58', reason: 'The function writes logs to its own managed log group through an explicit grant (logGroup.grantWrite).' },
            { id: 'W89', reason: 'Function only transforms records Firehose passes to it and calls no network resources; a VPC adds no isolation.' },
            { id: 'W92', reason: 'Concurrency depends on the consumer\'s throughput; set reservedConcurrentExecutions in transformationFunctionProps.' }
          ]
        })
      }

      // The default Lambda role may only write to /aws/lambda/* log groups. Without this grant,
      // every log event sent to the managed group is denied and silently dropped.
      if (this.transformationLogGroup) {
        this.transformationLogGroup.grantWrite(this.transformationLambda)
      }

      // X-Ray trace writes do not support resource-level permissions (Resource "*")
      const defaultPolicy = this.transformationLambda.role?.node.tryFindChild('DefaultPolicy')?.node.defaultChild as CfnResource | undefined
      defaultPolicy?.addMetadata('cfn_nag', {
        rules_to_suppress: [{ id: 'W12', reason: 'X-Ray PutTraceSegments and PutTelemetryRecords require Resource "*".' }]
      })

      if (!props.existingTransformationLambdaObj) {
        suppressCheckov(this.transformationLambda.node.defaultChild as CfnResource, [
          { id: 'CKV_AWS_116', comment: 'Invoked synchronously by Firehose; failed records are retried by Firehose and written to the S3 processing-failed prefix, so a DLQ is not used.' },
          { id: 'CKV_AWS_117', comment: 'Function only receives records from Firehose and calls no network resources; no VPC is required.' },
          { id: 'CKV_AWS_173', comment: 'Environment variables contain only non-sensitive runtime flags set by AWS Solutions Constructs; they are encrypted at rest with the AWS managed key.' }
        ])
        // LAMBDA_DLQ_CHECK: same rationale as CKV_AWS_116 above (synchronous Firehose invocation)
        suppressGuard(this.transformationLambda.node.defaultChild as CfnResource, ['LAMBDA_DLQ_CHECK'])
      }

    }

    // Firehose encrypts delivered objects with the KMS key named here. Solutions Constructs defaults to the
    // AWS managed alias/aws/s3 key; use the pipeline's customer managed key instead.
    firehoseProps = {
      kinesisFirehoseProps: {
        extendedS3DestinationConfiguration: {
          encryptionConfiguration: {
            kmsEncryptionConfig: { awskmsKeyArn: this.encryptionKey.keyArn }
          },
          ...(this.transformationLambda
            ? {
                processingConfiguration: {
                  enabled: true,
                  processors: [
                    {
                      type: 'Lambda',
                      parameters: [
                        {
                          parameterName: 'LambdaArn',
                          parameterValue: this.transformationLambda.functionArn
                        }
                      ]
                    }
                  ]
                }
              }
            : {})
        }
      }
    }

    // Server access logs only support SSE-S3 on the destination bucket, so the access-log bucket keeps S3
    // managed encryption; it expires logs on the same schedule as the CloudWatch log groups.
    const loggingBucketProps: s3.BucketProps = {
      ...hardenedBucketDefaults,
      ...(logRetention === logs.RetentionDays.INFINITE
        ? {}
        : { lifecycleRules: [{ id: 'ExpireAccessLogs', enabled: true, expiration: Duration.days(logRetention) }] })
    }

    // Create the Kinesis stream, Firehose, and target S3 bucket
    this.kinesisStreamsToKinesisFirehoseToS3 = new KinesisStreamsToKinesisFirehoseToS3(this, 'stream-firehose-s3', {
      bucketProps: {
        ...hardenedBucketDefaults,
        encryption: s3.BucketEncryption.KMS,
        encryptionKey: this.encryptionKey,
        bucketKeyEnabled: true,
        ...props.bucketProps
      },
      loggingBucketProps,
      logGroupProps: {
        retention: logRetention,
        encryptionKey: this.encryptionKey
      },
      ...firehoseProps
    })

    const pipeline = this.kinesisStreamsToKinesisFirehoseToS3
    emitBooleanSecureTransport(pipeline.s3Bucket)
    emitBooleanSecureTransport(pipeline.s3LoggingBucket)

    // The access-log bucket is the terminal destination for S3 server access logs
    if (pipeline.s3LoggingBucket) {
      suppressCheckov(pipeline.s3LoggingBucket.node.defaultChild as CfnResource, [
        { id: 'CKV_AWS_18', comment: 'This bucket is the server access log destination for the data bucket; logging it to itself or another bucket would create a recursive logging chain.' }
      ])
    }

    // S3_BUCKET_DEFAULT_LOCK_ENABLED: Object Lock is a data-retention choice that would block `cdk destroy`
    //   cleanup of this sample; enable it via bucketProps when compliance retention is required.
    // S3_BUCKET_REPLICATION_ENABLED: cross-Region replication is a resiliency/cost decision outside the
    //   scope of this single-Region sample.
    for (const bucket of [pipeline.s3Bucket, pipeline.s3LoggingBucket]) {
      if (bucket) {
        suppressGuard(bucket.node.defaultChild as CfnResource, ['S3_BUCKET_DEFAULT_LOCK_ENABLED', 'S3_BUCKET_REPLICATION_ENABLED'])
      }
    }

    // CLOUDWATCH_ALARM_ACTION_CHECK: alarm notification targets (SNS topic, pager) are environment-specific;
    //   consumers attach actions via the exposed cloudwatchAlarms.
    for (const alarm of pipeline.cloudwatchAlarms ?? []) {
      suppressGuard(alarm.node.defaultChild as CfnResource, ['CLOUDWATCH_ALARM_ACTION_CHECK'])
    }

    // Grant access to Kinesis Firehose to invoke the transformation lambda
    if (this.transformationLambda) {
      this.transformationLambda.grantInvoke(this.kinesisStreamsToKinesisFirehoseToS3.kinesisFirehoseRole)
    }

    // Firehose writes objects encrypted with the customer managed key (see encryptionConfiguration above).
    // Only the two actions S3 needs, only when called through S3 in this Region, and only for this bucket.
    // With S3 Bucket Keys the encryption context is the bucket ARN; otherwise it is the object ARN.
    // See https://docs.aws.amazon.com/firehose/latest/dev/controlling-access.html#using-iam-s3
    if (pipeline.s3Bucket) {
      pipeline.kinesisFirehoseRole.addToPrincipalPolicy(new iam.PolicyStatement({
        sid: 'EncryptDeliveredObjects',
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: [this.encryptionKey.keyArn],
        conditions: {
          StringEquals: { 'kms:ViaService': `s3.${Stack.of(this).region}.amazonaws.com` },
          ArnLike: { 'kms:EncryptionContext:aws:s3:arn': [pipeline.s3Bucket.bucketArn, `${pipeline.s3Bucket.bucketArn}/*`] }
        }
      }))
    }

    // ---- cdk-nag: documented suppressions for rules that do not apply to this design ----
    suppressCdkNagByType(this, ['AWS::IAM::Role', 'AWS::IAM::Policy'], iamWildcardSuppressions())

    if (this.transformationLambda && !props.existingTransformationLambdaObj) {
      suppressCdkNag(this.transformationLambda.node.defaultChild as CfnResource, [
        ...compliancePackIds('LambdaDLQ', ['HIPAA.Security', 'NIST.800.53.R5']).map((id) => ({
          id, reason: 'Invoked synchronously by Firehose; failed records are retried by Firehose and written to the S3 processing-failed prefix.'
        })),
        ...compliancePackIds('LambdaInsideVPC').map((id) => ({
          id, reason: 'Function only transforms records Firehose passes to it and calls no network resources; a VPC adds no isolation.'
        }))
      ])
    }

    suppressCdkNag(pipeline.kinesisFirehose, [{
      id: 'AwsSolutions-KDF1',
      reason: 'Source is a KMS-encrypted Kinesis data stream; delivery-stream server-side encryption applies only to Direct PUT sources. Delivered objects use the customer managed key. See https://docs.aws.amazon.com/firehose/latest/dev/encryption.html'
    }])

    for (const bucket of [pipeline.s3Bucket, pipeline.s3LoggingBucket]) {
      if (bucket) {
        suppressCdkNag(bucket.node.defaultChild as CfnResource, compliancePackIds('S3BucketReplicationEnabled').map((id) => ({
          id, reason: 'Cross-Region replication is a resiliency and cost decision outside the scope of this single-Region sample.'
        })))
      }
    }
    if (pipeline.s3LoggingBucket) {
      suppressCdkNag(pipeline.s3LoggingBucket.node.defaultChild as CfnResource, compliancePackIds('S3DefaultEncryptionKMS').map((id) => ({
        id, reason: 'S3 server access log delivery supports only SSE-S3 on the destination bucket; SSE-KMS is not supported there. See https://docs.aws.amazon.com/AmazonS3/latest/userguide/enable-server-access-logging.html'
      })))
    }

    for (const alarm of pipeline.cloudwatchAlarms ?? []) {
      suppressCdkNag(alarm.node.defaultChild as CfnResource, compliancePackIds('CloudWatchAlarmAction', ['HIPAA.Security', 'NIST.800.53.R5']).map((id) => ({
        id, reason: 'Notification targets (SNS topic, pager) are environment-specific; consumers attach actions through the exposed cloudwatchAlarms.'
      })))
    }

    // Shallow merge: user-supplied top-level props replace defaults wholesale (e.g. partitionKey).
    // This replaces the previous deepmerge call (GHSA-gcqx-w48m-w2h4, prototype poisoning).
    const _dynamoTableProps: dynamodb.TableProps = {
      kinesisStream: this.kinesisStreamsToKinesisFirehoseToS3.kinesisStream,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      ...defaultTableProps,
      ...props.dynamoTableProps
    }

    // Setup the DynamoDB table
    this.dynamoTable = defaults.buildDynamoDBTable(this, {
      dynamoTableProps: _dynamoTableProps,
    }).tableObject as dynamodb.Table;

    suppressCdkNag(this.dynamoTable.node.defaultChild as CfnResource, compliancePackIds('DynamoDBInBackupPlan', ['HIPAA.Security', 'NIST.800.53.R5']).map((id) => ({
      id, reason: 'Point-in-time recovery is enabled (35-day continuous backups); an AWS Backup plan is an account-level policy decision outside this construct.'
    })))
  }
}

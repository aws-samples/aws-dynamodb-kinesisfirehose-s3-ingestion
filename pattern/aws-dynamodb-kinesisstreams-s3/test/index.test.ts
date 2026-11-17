// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { AwsDynamoDBKinesisStreamsS3, AwsDynamoDBKinesisStreamsS3Props } from '../lib';

const modelName = 'SourceData';

function synth (props: AwsDynamoDBKinesisStreamsS3Props): { stack: Stack, construct: AwsDynamoDBKinesisStreamsS3, template: Template } {
  const stack = new Stack();
  const construct = new AwsDynamoDBKinesisStreamsS3(stack, 'Test', props);
  return { stack, construct, template: Template.fromStack(stack) };
}

const tableProps: AwsDynamoDBKinesisStreamsS3Props = {
  dynamoTableProps: {
    partitionKey: { name: `${modelName}Id`, type: dynamodb.AttributeType.STRING },
    tableName: modelName
  }
};

describe('AwsDynamoDBKinesisStreamsS3', () => {
  test('creates a table streaming to Kinesis with user props overriding defaults', () => {
    const { template } = synth(tableProps);

    template.hasResource('AWS::DynamoDB::Table', {
      Properties: {
        KeySchema: [{ AttributeName: `${modelName}Id`, KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: `${modelName}Id`, AttributeType: 'S' }],
        BillingMode: 'PAY_PER_REQUEST',
        KinesisStreamSpecification: { StreamArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('KinesisStream'), 'Arn'] } },
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        TableName: modelName
      },
      UpdateReplacePolicy: 'Retain',
      DeletionPolicy: 'Retain'
    });
  });

  test('encrypts the table and Firehose log group with a rotating customer managed key', () => {
    const { template } = synth(tableProps);

    template.resourceCountIs('AWS::KMS::Key', 1);
    template.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      SSESpecification: {
        SSEEnabled: true,
        SSEType: 'KMS',
        KMSMasterKeyId: { 'Fn::GetAtt': [Match.stringLikeRegexp('EncryptionKey'), 'Arn'] }
      }
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      KmsKeyId: { 'Fn::GetAtt': [Match.stringLikeRegexp('EncryptionKey'), 'Arn'] },
      RetentionInDays: 365
    });
  });

  test('uses a caller-supplied encryption key instead of creating one', () => {
    const stack = new Stack();
    const key = new kms.Key(stack, 'CallerKey', { enableKeyRotation: true });
    const construct = new AwsDynamoDBKinesisStreamsS3(stack, 'Test', { ...tableProps, encryptionKey: key });

    expect(construct.encryptionKey).toBe(key);
    Template.fromStack(stack).resourceCountIs('AWS::KMS::Key', 1);
  });

  test('buckets block public access, disable ACLs and deny non-TLS requests with a boolean condition', () => {
    const { template } = synth(tableProps);

    const buckets = template.findResources('AWS::S3::Bucket');
    expect(Object.keys(buckets)).toHaveLength(2);
    for (const bucket of Object.values(buckets)) {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true
      });
      expect(bucket.Properties.OwnershipControls).toEqual({ Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] });
      expect(bucket.Properties.AccessControl).toBe('Private');
    }

    const policies = template.findResources('AWS::S3::BucketPolicy');
    expect(Object.keys(policies)).toHaveLength(2);
    for (const policy of Object.values(policies)) {
      expect(policy.Properties.PolicyDocument.Statement).toContainEqual(expect.objectContaining({
        Effect: 'Deny',
        Condition: { Bool: { 'aws:SecureTransport': false } }
      }));
    }
  });

  test('data bucket and Firehose deliveries use the customer managed key, and Firehose may use it', () => {
    const { template } = synth(tableProps);
    const keyArn = { 'Fn::GetAtt': [Match.stringLikeRegexp('EncryptionKey'), 'Arn'] };

    const buckets = Object.values(template.findResources('AWS::S3::Bucket'));
    const kmsBuckets = buckets.filter((b) => JSON.stringify(b.Properties.BucketEncryption).includes('aws:kms'));
    expect(kmsBuckets).toHaveLength(1);
    expect(kmsBuckets[0].Properties.BucketEncryption.ServerSideEncryptionConfiguration[0]).toEqual({
      BucketKeyEnabled: true,
      ServerSideEncryptionByDefault: {
        SSEAlgorithm: 'aws:kms',
        KMSMasterKeyID: { 'Fn::GetAtt': [expect.stringMatching(/EncryptionKey/), 'Arn'] }
      }
    });

    template.hasResourceProperties('AWS::KinesisFirehose::DeliveryStream', {
      ExtendedS3DestinationConfiguration: Match.objectLike({
        EncryptionConfiguration: { KMSEncryptionConfig: { AWSKMSKeyARN: keyArn } }
      })
    });

    // Firehose gets exactly the two KMS actions S3 needs, only via S3, only for this bucket
    const firehoseKms = Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((p) => JSON.stringify(p.Properties.Roles).includes('KinesisFirehoseRole'))
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter((s) => JSON.stringify(s.Action).includes('kms:'));
    expect(firehoseKms).toHaveLength(1);
    expect(firehoseKms[0]).toEqual(expect.objectContaining({
      Sid: 'EncryptDeliveredObjects',
      Effect: 'Allow',
      Action: ['kms:GenerateDataKey', 'kms:Decrypt'],
      Resource: { 'Fn::GetAtt': [expect.stringMatching(/EncryptionKey/), 'Arn'] },
      Condition: {
        StringEquals: { 'kms:ViaService': expect.anything() },
        ArnLike: { 'kms:EncryptionContext:aws:s3:arn': [expect.anything(), expect.anything()] }
      }
    }));
  });

  test('transformation Lambda role has no /aws/lambda/* wildcard and no unused role is left behind', () => {
    const { template } = synth({
      ...tableProps,
      applyTransformation: true,
      transformationFunctionProps: {
        code: lambda.Code.fromInline('exports.handler = async (e) => ({ records: [] })'),
        runtime: lambda.Runtime.NODEJS_24_X,
        handler: 'index.handler'
      }
    });
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toContain('log-group:/aws/lambda/*');

    // Exact match on the trust policy's service principal (not a substring search)
    const trustsService = (role: any, service: string): boolean =>
      (role.Properties.AssumeRolePolicyDocument.Statement as any[]).some((s) =>
        ([] as unknown[]).concat(s.Principal?.Service ?? []).some((p) => p === service));
    const lambdaRoles = Object.entries(template.findResources('AWS::IAM::Role'))
      .filter(([, r]) => trustsService(r, 'lambda.amazonaws.com'));
    expect(lambdaRoles).toHaveLength(1);
    expect(lambdaRoles[0][1].Properties.Policies).toBeUndefined();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Role: { 'Fn::GetAtt': [lambdaRoles[0][0], 'Arn'] },
      TracingConfig: { Mode: 'Active' }
    });
  });

  test('access-log bucket keeps SSE-S3 (required for server access logs) and expires logs', () => {
    const { template } = synth(tableProps);
    const logging = Object.values(template.findResources('AWS::S3::Bucket'))
      .filter((b) => !JSON.stringify(b.Properties.BucketEncryption).includes('aws:kms'));
    expect(logging).toHaveLength(1);
    expect(logging[0].Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault)
      .toEqual({ SSEAlgorithm: 'AES256' });
    expect(logging[0].Properties.LifecycleConfiguration.Rules).toContainEqual(
      expect.objectContaining({ Id: 'ExpireAccessLogs', ExpirationInDays: 365, Status: 'Enabled' }));
  });

  test('CloudWatch Logs key grant is limited to this account', () => {
    const { template } = synth(tableProps);
    template.hasResourceProperties('AWS::KMS::Key', {
      KeyPolicy: {
        Statement: Match.arrayWith([Match.objectLike({
          Sid: 'AllowCloudWatchLogsUse',
          Condition: Match.objectLike({ StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } } })
        })])
      }
    });
  });

  test('every IAM role and policy carries documented cdk-nag suppressions', () => {
    const { template } = synth(tableProps);
    const iam = { ...template.findResources('AWS::IAM::Role'), ...template.findResources('AWS::IAM::Policy') };
    expect(Object.keys(iam).length).toBeGreaterThan(0);
    for (const resource of Object.values(iam)) {
      const rules = resource.Metadata?.cdk_nag?.rules_to_suppress ?? [];
      expect(rules.map((r: { id: string }) => r.id)).toContain('AwsSolutions-IAM5');
      for (const r of rules) expect(r.reason.length).toBeGreaterThanOrEqual(10);
    }
  });

  test('adds a transformation Lambda that Firehose can invoke', () => {
    const { template } = synth({
      ...tableProps,
      applyTransformation: true,
      transformationFunctionProps: {
        code: lambda.Code.fromInline('exports.handler = async (e) => ({ records: [] })'),
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler'
      }
    });

    template.resourceCountIs('AWS::Lambda::Function', 1);
    // The function logs to a managed log group (retention + CMK), not an auto-created one
    template.hasResourceProperties('AWS::Lambda::Function', {
      LoggingConfig: { LogGroup: { Ref: Match.stringLikeRegexp('TransformationLogGroup') } }
    });
    template.resourcePropertiesCountIs('AWS::Logs::LogGroup', {
      KmsKeyId: { 'Fn::GetAtt': [Match.stringLikeRegexp('EncryptionKey'), 'Arn'] },
      RetentionInDays: 365
    }, 2);
    // ...and its role may write to that group (the default role only covers /aws/lambda/*)
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({
          Action: Match.arrayWith(['logs:CreateLogStream', 'logs:PutLogEvents']),
          Effect: 'Allow',
          Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('TransformationLogGroup'), 'Arn'] }
        })])
      }
    });
    template.hasResourceProperties('AWS::KinesisFirehose::DeliveryStream', {
      ExtendedS3DestinationConfiguration: Match.objectLike({
        ProcessingConfiguration: Match.objectLike({ Enabled: true })
      })
    });
  });
});

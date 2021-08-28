// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {expect as expectCDK, haveResource, ResourcePart} from '@aws-cdk/assert';
import {AwsDynamoDBKinesisStreamsS3} from '../lib';
import * as cdk from '@aws-cdk/core';
import * as dynamodb from '@aws-cdk/aws-dynamodb'

const modelName = 'SourceData';

describe('AwsDynamoDBKinesisStreamsS3', () => {
  const stack = new cdk.Stack();

  test('Default parameters creates a table with kinesis stream', () => {
    new AwsDynamoDBKinesisStreamsS3(stack, 'AwsDynamodbKinesisfirehoseS3Test', {
      dynamoTableProps: {
        partitionKey: {
          name: `${modelName}Id`,
          type: dynamodb.AttributeType.STRING
        },
        tableName: modelName
      }
    });

    expectCDK(stack).to(
      haveResource(
        'AWS::DynamoDB::Table',
        {
          Properties: {
            KeySchema: [
              {
                AttributeName: `${modelName}Id`,
                KeyType: 'HASH',
              },
            ],
            AttributeDefinitions: [
              {
                AttributeName: `${modelName}Id`,
                AttributeType: 'S',
              },
            ],
            BillingMode: 'PAY_PER_REQUEST',
            KinesisStreamSpecification: {
              StreamArn: {
                "Fn::GetAtt": [
                  "AwsDynamodbKinesisfirehoseS3Teststreamfirehoses3KinesisStream93F9AB31",
                  "Arn"
                ]
              }
            },
            PointInTimeRecoverySpecification: {
              PointInTimeRecoveryEnabled: true
            },
            SSESpecification: {
              SSEEnabled: true
            },
            TableName: modelName,
          },
          UpdateReplacePolicy: 'Retain',
          DeletionPolicy: 'Retain',
        },
        ResourcePart.CompleteDefinition,
        true,
      ),
    );

    expectCDK(stack).to(
      haveResource(
        'AWS::S3::Bucket',
        {
          Properties: {
            BucketEncryption: {
              ServerSideEncryptionConfiguration: [
                {
                  ServerSideEncryptionByDefault: {
                    SSEAlgorithm: 'AES256'
                  }
                }
              ]
            },
            LifecycleConfiguration: {
              Rules: [
                {
                  NoncurrentVersionTransitions: [
                    {
                      StorageClass: 'GLACIER',
                      TransitionInDays: 90
                    }
                  ],
                  Status: 'Enabled'
                }
              ]
            },
            LoggingConfiguration: {
              DestinationBucketName: {
                Ref: 'AwsDynamodbKinesisfirehoseS3Teststreamfirehoses3KinesisFirehoseToS3S3LoggingBucket32AD5B5D'
              }
            },
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              BlockPublicPolicy: true,
              IgnorePublicAcls: true,
              RestrictPublicBuckets: true
            },
            VersioningConfiguration: {
              Status: 'Enabled'
            }

          },
          UpdateReplacePolicy: 'Retain',
          DeletionPolicy: 'Retain',
        },
        ResourcePart.CompleteDefinition,
        true,
      ),
    );
  });
});

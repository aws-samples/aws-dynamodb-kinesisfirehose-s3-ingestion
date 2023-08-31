// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { KinesisStreamsToKinesisFirehoseToS3, KinesisStreamsToKinesisFirehoseToS3Props } from '@aws-solutions-constructs/aws-kinesisstreams-kinesisfirehose-s3'
import * as defaults from '@aws-solutions-constructs/core'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'
import * as deepmerge from 'deepmerge'
import { isPlainObject } from './utils'

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
}

/**
 * Default DynamoDB table properties used in case no user provided value is present
 */
const defaultTableProps: dynamodb.TableProps = {
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  pointInTimeRecovery: true,
  partitionKey: {
    name: 'id',
    type: dynamodb.AttributeType.STRING
  }
}

export class AwsDynamoDBKinesisStreamsS3 extends Construct {
  public readonly transformationLambda?: lambda.Function;
  public readonly dynamoTable: dynamodb.Table;
  public readonly kinesisStreamsToKinesisFirehoseToS3: KinesisStreamsToKinesisFirehoseToS3;

  /**
   * @summary Constructs a new instance of the AwsDynamodbKinesisStreamsS3 class.
   * @param {Construct} scope - represents the scope for all the resources.
   * @param {string} id - this is a a scope-unique id.
   * @param {AwsDynamoDBKinesisStreamsS3} props - user provided props for the construct.
   */

  constructor(scope: Construct, id: string, props: AwsDynamoDBKinesisStreamsS3Props) {
    super(scope, id)
    let firehoseProps: KinesisStreamsToKinesisFirehoseToS3Props = {}

    if (props.applyTransformation) {
      // Create the lambda function that will transform the data
      this.transformationLambda = defaults.buildLambdaFunction(this, {
        existingLambdaObj: props.existingTransformationLambdaObj,
        lambdaFunctionProps: props.transformationFunctionProps
      })

      // Create the Kinesis Firehose properties that includes the transformation function
      firehoseProps = {
        kinesisFirehoseProps: {
          extendedS3DestinationConfiguration: {
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
        }
      }
    }

    // Create the Kinesis stream, Firehose, and target S3 bucket
    this.kinesisStreamsToKinesisFirehoseToS3 = new KinesisStreamsToKinesisFirehoseToS3(this, 'stream-firehose-s3', {
      bucketProps: props.bucketProps,
      ...firehoseProps
    })

    // Grant access to Kinesis Firehose to invoke the transformation lambda
    if (this.transformationLambda) {
      this.transformationLambda.grantInvoke(this.kinesisStreamsToKinesisFirehoseToS3.kinesisFirehoseRole)
    }

    let _dynamoTableProps: dynamodb.TableProps = {
      kinesisStream: this.kinesisStreamsToKinesisFirehoseToS3.kinesisStream,
      ...defaultTableProps
    }

    if (props.dynamoTableProps) {
      _dynamoTableProps = deepmerge(_dynamoTableProps, props.dynamoTableProps,
        {
          arrayMerge: (target: any[], source: any[]) => {
            target = source
            return target
          },
          isMergeableObject: isPlainObject
        })
    }

    // Setup the DynamoDB table
    this.dynamoTable = defaults.buildDynamoDBTable(this, {
      dynamoTableProps: _dynamoTableProps,
    }).tableObject as dynamodb.Table;
  }
}

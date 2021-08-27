# DynamoDB ingestion into S3 with Kinesis Data Streams and Firehose	
<!--BEGIN STABILITY BANNER-->
---

![Stability: Experimental](https://img.shields.io/badge/stability-Experimental-important.svg?style=for-the-badge)

> **This is an experimental example. It may not build out of the box**
>
> This example is built using Construct Libraries marked "Experimental" and may not be updated for latest breaking changes.
>
> If build is unsuccessful, please create an [issue](https://github.com/aws-samples/aws-dynamodb-kinesisfirehose-s3-ingestion/issues/new) so that we may debug the problem 

---
<!--END STABILITY BANNER-->

This a sample AWS CDK Construct (L3) that delivers Amazon DynamoDB records to an S3 bucket using Amazon Kinesis Data Streams and Kinesis Data Firehose.

## Build

To install and build this package run the following commands:

```bash
npm install -g aws-cdk
npm install
npm run build
```

## The Component Structure

This construct provisions by default:

#### Amazon DynamoDB Table
- Set the billing mode for DynamoDB Table to On-Demand (Pay per request)
- Enable server-side encryption for DynamoDB Table using AWS managed KMS Key
- Creates a partition key called 'id' for DynamoDB Table
- Retain the Table when deleting the CloudFormation stack
- Enable continuous backups and point-in-time recovery

#### Amazon Kinesis Stream
- Configure least privilege access IAM role for Amazon Kinesis Stream
- Enable server-side encryption for Amazon Kinesis Stream using AWS Managed KMS Key
- Deploy best practices CloudWatch Alarms for the Amazon Kinesis Stream

#### Amazon Kinesis Firehose
- Enable CloudWatch logging for Amazon Kinesis Firehose
- Configure least privilege access IAM role for Amazon Kinesis Firehose

#### Amazon S3 Bucket
- Configure Access logging for Amazon S3 Bucket
- Enable server-side encryption for Amazon S3 Bucket using AWS managed KMS Key
- Enforce encryption of data in transit
- Turn on the versioning for Amazon S3 Bucket
- Don't allow public access for Amazon S3 Bucket
- Retain the Amazon S3 Bucket when deleting the CloudFormation stack
- Applies Lifecycle rule to move non-current object versions to Glacier storage after 90 days

#### AWS Lambda Function
- Configure limited privilege access IAM role for AWS Lambda function
- Enable X-Ray Tracing
- Set Environment Variables
- AWS_NODEJS_CONNECTION_REUSE_ENABLED (for Node 12.x and higher functions)

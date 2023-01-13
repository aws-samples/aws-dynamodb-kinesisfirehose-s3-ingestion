#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { App } from 'aws-cdk-lib';
import 'source-map-support/register';
import { AwsServerlessDynamoDbS3IngestionStack } from '../lib/aws-serverless-dynamodb-s3-ingestion-stack';

const app = new App();

new AwsServerlessDynamoDbS3IngestionStack(app, 'AwsDynamodbKinesisfirehoseS3IngestionStack');

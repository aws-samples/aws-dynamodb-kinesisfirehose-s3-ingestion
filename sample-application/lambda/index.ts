// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { unmarshall } from "@aws-sdk/util-dynamodb";

/**
 *
 * @param event
 * @returns processed data from dynamo db table.
 */
export const handler = async (
    event: any
): Promise<any> => {
    // Record payloads are not logged to avoid writing table data to CloudWatch Logs
    console.log(`Received ${event.records.length} record(s).`);
    // Process the list of records and transform them
    const output = event.records.map((record: any) => {
        const decodedRecord = JSON.parse((Buffer.from(record.data, 'base64').toString()));
        const payload = unmarshall(decodedRecord.dynamodb.NewImage);
        // Generating output result and encoding the payload.
        // Newline-delimited so Athena / AWS Glue can read the delivered objects as JSON Lines.
        return {
            recordId: record.recordId,
            result: 'Ok',
            data: (Buffer.from(JSON.stringify(payload) + '\n')).toString('base64'),
        };
    });
    console.log(`Processing completed.  Successful record(s) ${output.length}.`);
    return { records: output };
}

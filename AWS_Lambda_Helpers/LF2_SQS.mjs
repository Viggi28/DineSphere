import AWS from "aws-sdk";
import fetch from "node-fetch";
import { AWS4Auth } from "aws4fetch";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const sqs = new AWS.SQS();
const ses = new AWS.SES();
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const region = "us-east-1";

const queueUrl = "https://sqs.us-east-1.amazonaws.com/975050055589/diningsuggestionsqueue";
const openSearchEndpoint = "https://search-restaurants-dfpgb2gmqeqgcil7uat7vmjima.us-east-1.es.amazonaws.com/";
const verifiedEmail = "abhishek.nitt101@gmail.com";

const credentials = new AWS.SharedIniFileCredentials();
const awsAuth = new AWS4Auth({
  accessKeyId: credentials.accessKeyId,
  secretAccessKey: credentials.secretAccessKey,
  region,
  service: "es",
});

// Fetch restaurants from OpenSearch by cuisine
const fetchRestaurantsFromOpenSearch = async (cuisine) => {
  const headers = { "Content-Type": "application/json" };
  const query = {
    size: 3,
    query: {
      match: { Cuisine: cuisine },
    },
  };

  const openSearchUrl = `${openSearchEndpoint}/restaurants/_search`;

  try {
    const response = await fetch(openSearchUrl, {
      method: "GET",
      headers,
      body: JSON.stringify(query),
    });

    if (!response.ok) {
      console.error(`Error: Received status code ${response.status}`);
      console.error(await response.text());
      return null;
    }

    const responseJson = await response.json();
    console.log(`OpenSearch response: ${JSON.stringify(responseJson)}`);

    if (responseJson.hits && responseJson.hits.total.value > 0) {
      return responseJson.hits.hits.map((hit) => hit._source);
    } else {
      console.log("No hits found for the query");
      return null;
    }
  } catch (error) {
    console.error(`Error fetching from OpenSearch: ${error.message}`);
    return null;
  }
};

// Fetch restaurant details from DynamoDB by business ID
const fetchRestaurantFromDynamoDb = async (businessId) => {
  const params = {
    TableName: "yelp-restaurants",
    FilterExpression: "BusinessID = :businessId",
    ExpressionAttributeValues: {
      ":businessId": businessId,
    },
  };

  try {
    const response = await dynamoDb.scan(params).promise();
    return response.Items && response.Items.length > 0 ? response.Items[0] : null;
  } catch (error) {
    console.error(`Error fetching from DynamoDB: ${error.message}`);
    return null;
  }
};

// Send an email with restaurant recommendations
const sendEmail = async (recipientEmail, subject, bodyText) => {
  const params = {
    Source: verifiedEmail,
    Destination: { ToAddresses: [recipientEmail] },
    Message: {
      Subject: { Data: subject },
      Body: { Text: { Data: bodyText } },
    },
  };

  try {
    const response = await ses.sendEmail(params).promise();
    console.log(`Email sent! Message ID: ${response.MessageId}`);
  } catch (error) {
    console.error(`Error sending email: ${error.message}`);
  }
};

// Store user's search history in DynamoDB
const storeSearchHistory = async (email, location, cuisine, diningTime, numberOfPeople, restaurantNames) => {
  const params = {
    TableName: "usersearchpreferences",
    Item: {
      email,
      location,
      cuisine,
      diningTime,
      numberOfPeople,
      restaurantNames,
    },
  };

  try {
    await dynamoDb.put(params).promise();
    console.log(`Stored search history for ${email}`);
  } catch (error) {
    console.error(`Error storing search history: ${error.message}`);
  }
};

// Lambda handler to process SQS messages
export const handler = async () => {
  const params = {
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 0,
  };

  try {
    const response = await sqs.receiveMessage(params).promise();

    if (!response.Messages) {
      console.log("No messages in the queue.");
      return { statusCode: 200, body: "No messages found in SQS queue" };
    }

    for (const message of response.Messages) {
      try {
        const messageBody = JSON.parse(message.Body);
        const { cuisine, email, location, diningTime, numberOfPeople } = messageBody;

        if (!cuisine || !email) {
          console.error(`Invalid message: ${JSON.stringify(messageBody)}`);
          continue;
        }

        const restaurants = await fetchRestaurantsFromOpenSearch(cuisine);
        if (!restaurants || restaurants.length < 3) {
          console.error(`Not enough restaurants found for ${cuisine}`);
          continue;
        }

        const restaurantDetailsList = [];
        const restaurantNames = [];

        for (const restaurant of restaurants) {
          const restaurantDetails = await fetchRestaurantFromDynamoDb(restaurant.RestaurantID);
          if (restaurantDetails) {
            restaurantDetailsList.push(restaurantDetails);
            restaurantNames.push(restaurantDetails.Name || "Unknown");
          }
        }

        if (restaurantDetailsList.length < 3) {
          console.error(`Not enough restaurant details found for ${cuisine}`);
          continue;
        }

        await storeSearchHistory(email, location, cuisine, diningTime, numberOfPeople, restaurantNames);

        const subject = `Your recommendations for ${cuisine} cuisine are here`;
        let bodyText = `Hello! Here are my ${cuisine} restaurant suggestions:\n\n`;

        restaurantDetailsList.forEach((details, index) => {
          bodyText += `${index + 1}. ${details.Name || "Unknown"}, located at ${details.Address || "Unknown"}\n`;
        });

        bodyText += "\nEnjoy your meal!";
        await sendEmail(email, subject, bodyText);

        await sqs.deleteMessage({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }).promise();
      } catch (error) {
        console.error(`Error processing message: ${error.message}`);
        continue;
      }
    }

    return { statusCode: 200, body: "Recommendations sent for all valid messages in the queue" };
  } catch (error) {
    console.error(`Error in Lambda function: ${error.message}`);
    return { statusCode: 500, body: `Error: ${error.message}` };
  }
};

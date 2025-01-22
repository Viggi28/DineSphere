import AWS from 'aws-sdk';
import { createLogger, format, transports } from 'winston';

// Initialize logger for monitoring and debugging
const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console(),
  ],
});

// Initialize Lex runtime client
const lexClient = new AWS.LexRuntimeV2();

export async function lambdaHandler(event, context) {
  logger.info('Received event', { event });

  let responseText = "Oops! Something went wrong. Please try again.";
  const sessionId = '0937741d-6a93-4e6b-9b6';

  try {
    // Extract user message from the request
    const body = JSON.parse(event.body);
    const userMessage = body.messages[0].unstructured.text;

    logger.info('User message and session info', { userMessage, sessionId });

    // Call Lex chatbot to process the user message
    const lexResponse = await lexClient.recognizeText({
      botId: 'NQ3LIN7QMZ',
      botAliasId: 'TSTALIASID',
      localeId: 'en_US',
      sessionId: sessionId,
      text: userMessage,
    }).promise();

    logger.info('Lex response', { lexResponse });

    // Extract the Lex response
    if (lexResponse.messages && lexResponse.messages.length > 0) {
      responseText = lexResponse.messages[0].content;
    } else {
      responseText = "I'm sorry, I couldn't understand that.";
    }
  } catch (error) {
    logger.error('Error processing request', { error });
  }

  // Format the response message
  const responseMessage = {
    messages: [
      {
        type: "unstructured",
        unstructured: {
          text: responseText,
        },
      },
    ],
    sessionId: sessionId,
  };

  // Return response with CORS headers
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(responseMessage),
  };
}

# Dinesphere Chatbot

## About
An intelligent dining concierge chatbot designed to provide personalized restaurant recommendations based on user input such as location, cuisine, time, and party size. Built with Amazon Lex for natural language understanding and AWS Lambda for backend processing, it seamlessly integrates with Amazon DynamoDB, OpenSearch, and SES to deliver a smooth and efficient user experience.

The project implements various AWS services, to create a chatbot that gathers information
from the user about a requested restaurant reservation, and sends a confirmation email.

## Files Included

1. Lambda Helper Functions 
2. SDK (for frontend)
3. Yelp Scrapper Code (both for DynamoDB and OpenSearch)

## Usage

1. Clone the repository.
2. Replace `/assets/js/sdk/apigClient.js` with your own SDK file from the API
   Gateway.
3. Open `chat.html` in any browser.
4. Start sending messages to test the chatbot interaction.

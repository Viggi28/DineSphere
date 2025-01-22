const AWS = require('aws-sdk');
const sqs = new AWS.SQS();
const dynamodb = new AWS.DynamoDB.DocumentClient();
const historyTable = 'usersearchpreferences';
const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/975050055589/diningsuggestionsqueue';

const SESSION_ID = '0937741d-6a93-4e6b-9b6';

// Handle incoming Lex event and process dining suggestions
exports.handler = async (event) => {
    console.log(`Event received: ${JSON.stringify(event)}`);
    
    const sessionId = SESSION_ID;
    console.log(`Using session ID: ${sessionId}`);
    
    const intentName = event.sessionState.intent.name;
    const sessionAttributes = event.sessionState.sessionAttributes || {};
    const slots = event.sessionState.intent.slots;

    if (intentName === 'GreetingIntent') {
        return closeIntent('GreetingIntent', 'Hi there, how can I help?');
    } else if (intentName === 'ThankYouIntent') {
        return closeIntent('ThankYouIntent', 'You are welcome! Feel free to ask anything else.');
    } else if (intentName === 'DiningSuggestionsIntent') {
        const emailSlot = slots.Email;

        if (!emailSlot || !emailSlot.value || !emailSlot.value.interpretedValue) {
            return elicitSlot('Email', slots, sessionAttributes, sessionId);
        }

        const email = emailSlot.value.interpretedValue;
        const previousSearch = await getPreviousSearch(email);

        if (previousSearch) {
            const confirmationState = sessionAttributes.confirmation_state || 'not_asked';

            if (confirmationState === 'not_asked') {
                sessionAttributes.confirmation_state = 'asked';
                return askForConfirmation(previousSearch, slots, sessionAttributes, sessionId);
            } else if (confirmationState === 'asked') {
                const userInput = (event.inputTranscript || '').toLowerCase();
                if (['yes', 'yeah', 'sure', 'okay'].includes(userInput)) {
                    slots.Location = { value: { interpretedValue: previousSearch.location } };
                    slots.Cuisine = { value: { interpretedValue: previousSearch.cuisine } };
                    slots.Time = { value: { interpretedValue: previousSearch.dining_time } };
                    slots.Partysize = { value: { interpretedValue: previousSearch.number_of_people } };

                    await sendMessageToSQS(
                        previousSearch.location,
                        previousSearch.cuisine,
                        previousSearch.dining_time,
                        previousSearch.number_of_people,
                        email
                    );

                    return closeIntent('DiningSuggestionsIntent', 'Thank you! You will receive an email with your previous dining suggestions shortly.');
                } else {
                    sessionAttributes.confirmation_state = 'denied';
                    return collectNewSlots(slots, sessionAttributes, sessionId);
                }
            }
        }

        return collectNewSlots(slots, sessionAttributes, sessionId);
    }

    return {
        statusCode: 400,
        body: JSON.stringify('Invalid intent'),
    };
};

// Utility to close intent
const closeIntent = (intentName, message) => ({
    sessionState: {
        dialogAction: {
            type: 'Close'
        },
        intent: {
            name: intentName,
            state: 'Fulfilled'
        }
    },
    messages: [{
        contentType: 'PlainText',
        content: message
    }]
});

// Elicit a specific slot
const elicitSlot = (slotToElicit, slots, sessionAttributes, sessionId) => ({
    sessionState: {
        dialogAction: {
            type: 'ElicitSlot',
            slotToElicit: slotToElicit
        },
        intent: {
            name: 'DiningSuggestionsIntent',
            slots
        },
        sessionAttributes,
        sessionId
    },
    messages: [{
        contentType: 'PlainText',
        content: `Please provide your ${slotToElicit}.`
    }]
});

// Ask user to confirm using previous search data
const askForConfirmation = (previousSearch, slots, sessionAttributes, sessionId) => ({
    sessionState: {
        dialogAction: {
            type: 'ElicitSlot',
            slotToElicit: 'Location'
        },
        intent: {
            name: 'DiningSuggestionsIntent',
            slots
        },
        sessionAttributes,
        sessionId
    },
    messages: [{
        contentType: 'PlainText',
        content: `Your previous search was for ${previousSearch.location} ${previousSearch.cuisine} cuisine. Would you like to use the same search again? (Yes/No)`
    }]
});

// Fetch user's previous search history from DynamoDB
const getPreviousSearch = async (email) => {
    try {
        const params = {
            TableName: historyTable,
            Key: { email }
        };
        const response = await dynamodb.get(params).promise();
        return response.Item;
    } catch (error) {
        console.error(`Error fetching previous search: ${error}`);
        return null;
    }
};

// Collect new slot values
const collectNewSlots = async (slots, sessionAttributes, sessionId) => {
    const requiredSlots = ['Location', 'Cuisine', 'Time', 'Partysize', 'Email'];
    for (const slot of requiredSlots) {
        if (!slots[slot] || !slots[slot].value || !slots[slot].value.interpretedValue) {
            return elicitSlot(slot, slots, sessionAttributes, sessionId);
        }
    }

    const location = slots.Location.value.interpretedValue;
    const cuisine = slots.Cuisine.value.interpretedValue;
    const diningTime = slots.Time.value.interpretedValue;
    const numberOfPeople = slots.Partysize.value.interpretedValue;
    const email = slots.Email.value.interpretedValue;

    await storeSearchHistory(email, location, cuisine, diningTime, numberOfPeople);
    await sendMessageToSQS(location, cuisine, diningTime, numberOfPeople, email);

    return closeIntent('DiningSuggestionsIntent', 'Thank you! You will receive an email with new dining suggestions shortly.');
};

// Store user's search history in DynamoDB
const storeSearchHistory = async (email, location, cuisine, diningTime, numberOfPeople) => {
    try {
        const params = {
            TableName: historyTable,
            Item: {
                email,
                location,
                cuisine,
                dining_time: diningTime,
                number_of_people: numberOfPeople
            }
        };
        await dynamodb.put(params).promise();
        console.log(`Stored search history for ${email}.`);
    } catch (error) {
        console.error(`Error storing search history: ${error}`);
    }
};

// Send dining suggestion message to SQS queue
const sendMessageToSQS = async (location, cuisine, diningTime, numberOfPeople, email) => {
    const messageBody = JSON.stringify({
        location,
        cuisine,
        dining_time: diningTime,
        number_of_people: numberOfPeople,
        email
    });

    try {
        const params = {
            QueueUrl: QUEUE_URL,
            MessageBody: messageBody
        };
        const response = await sqs.sendMessage(params).promise();
        console.log(`Message sent to SQS: ${response.MessageId}`);
    } catch (error) {
        console.error(`Error sending message to SQS: ${error}`);
    }
};

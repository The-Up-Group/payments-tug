// Serves static frontend files 
// Creates API endpoint

require('dotenv').config();

const express = require('express');

const path = require('path');
// Initialization of stripe with secret key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/config', (req, res) => {
    console.log('SECRET key prefix:', process.env.STRIPE_SECRET_KEY?.slice(0, 20));
    console.log('PUBLISHABLE key prefix:', process.env.STRIPE_PUBLISHABLE_KEY?.slice(0, 20));
    res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

app.post('/create-payment-intent', async (req, res) => {
    const amount = parseInt(req.body.amount, 10);
    if (!amount || amount <= 0){
        return res.status(400).send({error: 'Invalid amount provided'});
    }

    try {
        // Create Payment Intent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: 'mxn', 
            automatic_payment_methods: {
                enabled: true,
            }
        });

        // Send the client_secret back to the client
        res.send({
            clientSecret: paymentIntent.client_secret,
        });
    } catch (error) {
        console.error("Error creating payment intent: ", error);
        res.status(500).send({error: error.message});
    }
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Node server listening on port ${PORT}`)); 

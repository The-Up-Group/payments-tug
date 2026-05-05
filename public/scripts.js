// Set your publishable key. Remember to use environment variables in a real app.
// For this client-side example, it's okay to have it here.
const stripe = Stripe('YOUR_STRIPE_PUBLISHABLE_KEY'); // Replace with your actual publishable key

// --- Step 1: Initialize Stripe Elements ---
const elements = stripe.elements();
const cardElement = elements.create('card');
cardElement.mount('#card-element'); // Mount the card element to the div

// --- Step 2: Handle Form Submission ---
const form = document.getElementById('payment-form');
const submitButton = document.getElementById('submit-button');
const cardErrors = document.getElementById('card-errors');

form.addEventListener('submit', async (event) => {
  event.preventDefault(); // Prevent default form submission
  submitButton.disabled = true; // Disable button to prevent multiple clicks
  cardErrors.textContent = ''; // Clear previous errors

  // --- Step 3: Create Payment Intent on the Server ---
  // The amount is in cents (e.g., 1099 for $10.99)
  const response = await fetch('/create-payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 1099 }), 
  });
  
  const { clientSecret, error: backendError } = await response.json();

  if (backendError) {
    cardErrors.textContent = backendError.message;
    submitButton.disabled = false;
    return;
  }

  // --- Step 4: Confirm the Payment on the Client ---
  const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
    payment_method: {
      card: cardElement,
      billing_details: {
        name: 'Jenny Rosen', // Example billing details
      },
    },
  });
  
  if (error) {
    // Show error to your customer (e.g., insufficient funds)
    cardErrors.textContent = error.message;
    submitButton.disabled = false; // Re-enable the button
  } else {
    // The payment has been processed!
    if (paymentIntent.status === 'succeeded') {
      alert('Payment Succeeded!');
      // You can redirect the user to a success page here
      // window.location.href = '/success.html';
    }
  }
});
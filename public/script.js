let stripe;

async function initStripe() {
  const { publishableKey } = await fetch('/config').then(r => r.json());
  stripe = Stripe(publishableKey);

  const elements = stripe.elements();
  const cardElement = elements.create('card', {
    style: {
      base: {
        fontSize: '16px',
        color: '#1a1a2e',
        '::placeholder': { color: '#a0aec0' },
      },
      invalid: { color: '#e53e3e' },
    },
  });

  cardElement.mount('#card-element');

  cardElement.on('change', ({ error }) => {
    document.getElementById('card-errors').textContent = error ? error.message : '';
  });

  const form = document.getElementById('payment-form');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const btn = document.getElementById('submit-button');

    if (!name || !email) {
      document.getElementById('card-errors').textContent = 'Please fill in all fields.';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Processing…';

    try {
      const res = await fetch('/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1099, email }),
      });

      const { clientSecret, error: serverError } = await res.json();
      if (serverError) throw new Error(serverError);

      const { error: stripeError } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: { name, email },
        },
      });

      if (stripeError) throw new Error(stripeError.message);

      form.style.display = 'none';
      document.getElementById('payment-success').style.display = 'block';
    } catch (err) {
      document.getElementById('card-errors').textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Pay $10.99';
    }
  });
}

initStripe();

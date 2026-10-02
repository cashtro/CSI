const nodemailer = require('nodemailer');
const sendgridMail = require('@sendgrid/mail');

// Set your SendGrid API Key (from your SendGrid dashboard).
// Guarded so a missing key doesn't throw at import time (boot-safety).
if (process.env.SENDGRID_API_KEY) {
    sendgridMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
    console.warn('[emailService] SENDGRID_API_KEY not set — email sending is disabled.');
}
// Create a transporter using environment variables


const sendEmail = async (recipientEmail, subject, content) => {
    
    const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_EMAIL, // Your SendGrid verified email
        subject: subject,
        html: `<p>${content}</p>`, // Optionally, add HTML content
    };

    try {
        await sendgridMail.send(msg);
    } catch (error) {
        console.error('Error sending email:', error);
        // Handle error, maybe send a fallback or log to monitor issues
    }
};


const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});
// Function to send lottery winner notification
async function sendLotteryWinnerEmail(winnerEmail, lotteryDetails) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: winnerEmail,
        subject: 'Congratulations! You Won the Lottery!',
        html: `
            <h1>Congratulations ${lotteryDetails.winnerUsername}!</h1>
            <p>You have won the lottery "${lotteryDetails.name}"!</p>
            <p>Please contact the lottery owner ${lotteryDetails.ownerEmail} to claim your prize.</p>
            <p>Thank you for participating!</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('Error sending winner notification email:', error);
        throw error;
    }
}

// Function to send lottery owner notification
async function sendLotteryOwnerEmail(ownerEmail, details) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: ownerEmail,
        subject: 'Lottery Winner Selected',
        html: `
            <h1>Lottery Winner Selected</h1>
            <p>The lottery "${details.lotteryName}" has been completed.</p>
            <p>Winner's Details:</p>
            <ul>
                <li>Username: ${details.winnerUsername}</li>
                <li>Email: ${details.winnerEmail}</li>
            </ul>
            <p>Please contact the winner to arrange prize delivery.</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('Error sending owner notification email:', error);
        throw error;
    }
}

async function sendFullPriceProductOwnerEmail(ownerEmail, productDetails) {
        // Format shipping address (if available)
        const shippingAddress = productDetails.shippingAddress 
            ? `
                <h3>Shipping Address:</h3>
                <p>${productDetails.shippingAddress.line1 || ''}</p>
                ${productDetails.shippingAddress.line2 ? `<p>${productDetails.shippingAddress.line2}</p>` : ''}
                <p>${productDetails.shippingAddress.city}, ${productDetails.shippingAddress.state} ${productDetails.shippingAddress.postal_code}</p>
                <p>${productDetails.shippingAddress.country}</p>
            ` 
            : '<p>No shipping address provided.</p>';
    
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: ownerEmail,
            subject: 'Pandora Brand Product Purchase',
            html: `
                <h1>New Product Purchase</h1>
                <p>The product <strong>${productDetails.name}</strong> has been purchased at full price.</p>
                
                <h3>Order Details:</h3>
                <p>Quantity: ${productDetails.quantity}</p>
                <p>Size: ${productDetails.size || 'N/A'}</p>
                <p>Price: $${productDetails.price}</p>
                
                <h3>Buyer Information:</h3>
                <p>Email: ${productDetails.buyerEmail || 'Not provided'}</p>
                
                ${shippingAddress}
                
                <p>Please prepare the item for delivery.</p>
            `
        };
    
           

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('Error sending product purchase email:', error);
        throw error;
    }
}


module.exports = {
    sendEmail,
    sendLotteryWinnerEmail,
    sendLotteryOwnerEmail,
    sendFullPriceProductOwnerEmail
}; 
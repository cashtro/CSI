const nodemailer = require('nodemailer');
const logger = require('./logger');
const sendgridMail = require('@sendgrid/mail');

// Set your SendGrid API Key (from your SendGrid dashboard).
// Guarded so a missing key doesn't throw at import time (boot-safety).
if (process.env.SENDGRID_API_KEY) {
    sendgridMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
    logger.warn('[emailService] SENDGRID_API_KEY not set — email sending is disabled.');
}
// Create a transporter using environment variables


// Every value put into the HTML templates below may come from a user
// (username, product name, size, address): escape it.
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const e = escapeHtml;

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
        logger.error('Error sending email:', error);
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
            <h1>Congratulations ${e(lotteryDetails.winnerUsername)}!</h1>
            <p>You have won the lottery "${e(lotteryDetails.name)}"!</p>
            <p>Please contact the lottery owner ${e(lotteryDetails.ownerEmail)} to claim your prize.</p>
            <p>Thank you for participating!</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        logger.error('Error sending winner notification email:', error);
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
            <p>The lottery "${e(details.lotteryName)}" has been completed.</p>
            <p>Winner's Details:</p>
            <ul>
                <li>Username: ${e(details.winnerUsername)}</li>
                <li>Email: ${e(details.winnerEmail)}</li>
            </ul>
            <p>Please contact the winner to arrange prize delivery.</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        logger.error('Error sending owner notification email:', error);
        throw error;
    }
}

async function sendFullPriceProductOwnerEmail(ownerEmail, productDetails) {
        // Format shipping address (if available)
        const shippingAddress = productDetails.shippingAddress 
            ? `
                <h3>Shipping Address:</h3>
                <p>${e(productDetails.shippingAddress.line1)}</p>
                ${productDetails.shippingAddress.line2 ? `<p>${e(productDetails.shippingAddress.line2)}</p>` : ''}
                <p>${e(productDetails.shippingAddress.city)}, ${e(productDetails.shippingAddress.state)} ${e(productDetails.shippingAddress.postal_code)}</p>
                <p>${e(productDetails.shippingAddress.country)}</p>
            ` 
            : '<p>No shipping address provided.</p>';
    
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: ownerEmail,
            subject: 'Pandora Brand Product Purchase',
            html: `
                <h1>New Product Purchase</h1>
                <p>The product <strong>${e(productDetails.name)}</strong> has been purchased at full price.</p>
                
                <h3>Order Details:</h3>
                <p>Quantity: ${e(productDetails.quantity)}</p>
                <p>Size: ${e(productDetails.size || 'N/A')}</p>
                <p>Price: $${e(productDetails.price)}</p>
                
                <h3>Buyer Information:</h3>
                <p>Email: ${e(productDetails.buyerEmail || 'Not provided')}</p>
                
                ${shippingAddress}
                
                <p>Please prepare the item for delivery.</p>
            `
        };
    
           

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        logger.error('Error sending product purchase email:', error);
        throw error;
    }
}


module.exports = {
    sendEmail,
    sendLotteryWinnerEmail,
    sendLotteryOwnerEmail,
    sendFullPriceProductOwnerEmail,
    escapeHtml
}; 
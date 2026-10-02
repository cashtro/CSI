// Lottery and product e-mails escape user-controlled values (username, address).
jest.mock('nodemailer', () => {
  const sent = [];
  return { createTransport: () => ({ sendMail: async (m) => { sent.push(m); } }), _sent: sent };
});
jest.mock('@sendgrid/mail', () => ({ setApiKey: () => {}, send: async () => {} }));
require('./helpers/quiet');

const nodemailer = require('nodemailer');
const { sendLotteryWinnerEmail, sendLotteryOwnerEmail, sendFullPriceProductOwnerEmail } = require('../routes(api)/utils/emailService');

describe('e-mail templates escape user data', () => {
  it('lottery winner and owner e-mails', async () => {
    await sendLotteryWinnerEmail('w@x.ca', { winnerUsername: '<img src=x onerror=alert(1)>', name: 'Lot <b>', ownerEmail: 'o@x.ca' });
    await sendLotteryOwnerEmail('o@x.ca', { lotteryName: 'L', winnerUsername: '<a href="https://evil">clic</a>', winnerEmail: 'w@x.ca' });
    await sendFullPriceProductOwnerEmail('o@x.ca', { name: 'P', quantity: 1, size: '<script>', price: 3, buyerEmail: 'b@x.ca', shippingAddress: { line1: '<iframe>', city: 'Q', state: 'QC', postal_code: 'G1', country: 'CA' } });
    const html = nodemailer._sent.map((m) => m.html).join('\n');
    expect(html).not.toMatch(/<img|<a href|<script|<iframe|<b>/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

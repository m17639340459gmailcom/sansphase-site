import { readFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { smtpConfigured, smtpTransportOptions } from '../server/payload/smtp-settings.ts';

// This is a manual release check. It never sends a message without --send-to.
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !args[0].startsWith('--send-to='))) {
  console.error('Usage: node scripts/check-reader-email.mjs [--send-to=your-address@example.com]');
  process.exit(2);
}
const recipient = args[0]?.slice('--send-to='.length);
if (recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
  console.error('Invalid test recipient.');
  process.exit(2);
}

let transport;
try {
  const settings = JSON.parse(await readFile(process.env.PAYLOAD_CONFIG_FILE || '.local/payload-env.json', 'utf8'));
  if (!smtpConfigured(settings.smtp)) throw Object.assign(new Error(), { code: 'SMTP_NOT_CONFIGURED' });
  transport = nodemailer.createTransport(smtpTransportOptions(settings.smtp));
  await transport.verify();
  console.log('SMTP connection and authentication: OK');
  if (recipient) {
    await transport.sendMail({
      from: { name: settings.smtp.name || 'SANSPHASE', address: settings.smtp.from },
      to: recipient,
      subject: 'SANSPHASE 邮件投递测试',
      text: '这是个人站的发信测试。如果你收到此邮件，才能继续验收注册和密码找回。',
    });
    console.log('Test message accepted by the provider. Check the recipient inbox and spam folder to confirm delivery.');
  }
} catch (error) {
  const endpoint = error.address && error.port ? ` (${error.address}:${error.port})` : '';
  console.error(`Reader email check failed: ${error.code || 'UNKNOWN_ERROR'}${endpoint}`);
  process.exitCode = 1;
} finally {
  transport?.close();
}

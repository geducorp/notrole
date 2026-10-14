/**
 * Envia um e-mail de alerta da operacao do Notrole.
 *
 *   node scripts/servico/alerta.mjs "Assunto" "Texto do e-mail"
 *
 * Usado pelo watchdog, pelo deploy e pelo backup quando algo da errado (ou
 * volta ao normal). Le o SMTP do mesmo .env da API, entao funciona mesmo com
 * a API fora do ar. O destinatario vem de ALERTA_EMAIL (varios separados por
 * virgula).
 *
 * Sai com codigo 0 se enviou, 1 se nao conseguiu. Nunca lanca: quem chama so
 * registra a falha no proprio log.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(raiz, '.env'), quiet: true });

const [assunto, texto = ''] = process.argv.slice(2);
// Destinatarios: ALERTA_EMAIL no .env (varios separados por virgula).
const destino = (process.env.ALERTA_EMAIL || '').trim();

if (!assunto) {
  console.error('Uso: node alerta.mjs "Assunto" "Texto"');
  process.exit(1);
}
if (!destino) {
  console.error('ALERTA_EMAIL nao definido no .env: alerta nao enviado.');
  process.exit(1);
}

const transporte = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED === 'true' },
  // Alguns servidores SMTP corporativos levam mais de 10 s para responder ao "ola".
  connectionTimeout: 60_000,
  greetingTimeout: 60_000,
  socketTimeout: 120_000,
});

const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const corpo =
  `${texto}\n\n` +
  `--\n` +
  `Servidor: ${os.hostname()}\n` +
  `Quando: ${quando}\n` +
  `Logs: ${path.join(raiz, 'logs')}\n` +
  `Guia de problemas: ${path.join(raiz, 'docs', 'OPERACAO.md')}\n`;

// Duas tentativas: um alerta perdido por lentidao momentanea do SMTP e o pior
// tipo de falha aqui. Se as duas falharem, o watchdog tenta na proxima rodada.
for (let tentativa = 1; tentativa <= 2; tentativa++) {
  try {
    await transporte.sendMail({
      from: `"Notrole - Alerta" <${process.env.SMTP_USER}>`,
      to: destino,
      subject: `[Notrole] ${assunto}`,
      text: corpo,
    });
    console.log('Alerta enviado para ' + destino + '.');
    process.exit(0);
  } catch (erro) {
    console.error(`Falha ao enviar o alerta (tentativa ${tentativa}/2): ` + (erro?.message ?? erro));
    if (tentativa < 2) await new Promise((r) => setTimeout(r, 15_000));
  }
}
{
  process.exit(1);
}

export interface EmailMessage {
  to: string | string[];
  from?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface EmailSendResult {
  id: string;
}

export interface EmailService {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

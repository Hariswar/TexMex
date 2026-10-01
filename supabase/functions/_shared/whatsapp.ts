// wa.me deep links. Individuals get the chat opened with the message pre-filled;
// WhatsApp has no public link for a group chat, so groups open the share sheet
// with the text pre-filled and you pick the group yourself.

export interface LinkRecipient {
  type: 'individual' | 'group';
  phone: string | null;
}

export function whatsappLink(recipient: LinkRecipient, message: string): string {
  const text = encodeURIComponent(message);
  const digits = (recipient.phone ?? '').replace(/\D/g, '');
  if (recipient.type === 'individual' && digits) return `https://wa.me/${digits}?text=${text}`;
  return `https://wa.me/?text=${text}`;
}

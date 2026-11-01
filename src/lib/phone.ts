/**
 * Converts common ways of writing a number to E.164, such as +919876543210.
 * Numbers without a country code are treated as Indian. Returns null if invalid.
 */
export function normalizePhone(raw: string) {
  const cleaned = raw.trim().replace(/^'/, "").replace(/[\s().-]/g, "");

  if (cleaned.startsWith("+")) {
    if (cleaned.startsWith("+91")) return /^\+91[6-9]\d{9}$/.test(cleaned) ? cleaned : null;
    return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null;
  }

  const national = cleaned.replace(/^(0091|91(?=\d{10}$)|0(?=\d{10}$))/, "");
  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}

export function formatPhone(phone: string) {
  const indian = phone.match(/^\+91(\d{5})(\d{5})$/);
  return indian ? `+91 ${indian[1]} ${indian[2]}` : phone;
}

export function whatsappUrl(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

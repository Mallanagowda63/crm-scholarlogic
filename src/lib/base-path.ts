// Optional path the app is served under, e.g. "/crm" when it runs at scholarlogiclms.in/crm.
// Set NEXT_PUBLIC_BASE_PATH when building; empty means the app is at the root as before.
// Next.js <Link>, router.push and redirect() add it by themselves; plain <a>, <img> and <form action> need withBase().
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

export const withBase = (path: string) => `${BASE_PATH}${path}`;

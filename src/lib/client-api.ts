// fetch helper ฝั่ง client: โยน ApiClientError พร้อม field errors จาก server
export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, init?: Omit<RequestInit, "body"> & { body?: unknown }): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    headers: isForm ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
    body: init?.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiClientError(res.status, data.error ?? "เกิดข้อผิดพลาด", data.fields ?? {});
  return data as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
}

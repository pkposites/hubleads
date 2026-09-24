// Blueprint Appendix D.

export const API_ERRORS = {
  INVALID_REQUEST: { status: 400, message: "Payload inválido." },
  INVALID_PROJECT_KEY: { status: 401, message: "Chave de projeto ausente ou inválida." },
  ORIGIN_NOT_ALLOWED: { status: 403, message: "Domínio não autorizado para esta chave." },
  PROJECT_NOT_FOUND: { status: 404, message: "Projeto indisponível." },
  DUPLICATE_REQUEST: { status: 409, message: "Idempotency-Key já usada com outro payload." },
  RATE_LIMITED: { status: 429, message: "Limite de requisições excedido." },
  INTERNAL_ERROR: { status: 500, message: "Erro interno. Informe o request id ao suporte." },
} as const;

export type ApiErrorCode = keyof typeof API_ERRORS;

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly details?: FieldError[],
    message?: string,
  ) {
    super(message ?? API_ERRORS[code].message);
  }

  get status() {
    return API_ERRORS[this.code].status;
  }
}

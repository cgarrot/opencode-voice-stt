export const formatError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
};

export const truncate = (value: string, length = 360): string => {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}…`;
};

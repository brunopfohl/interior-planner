export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function uuid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApiError(400, "Invalid ID");
  return value;
}
export async function body(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "Expected a JSON request body");
  }
}

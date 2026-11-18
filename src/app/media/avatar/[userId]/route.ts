import { getSessionContext } from "@/lib/dal/context";
import { getAvatarObject } from "@/lib/dal/photos";
import { photoResponse, plainStatus } from "@/app/media/response";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) return plainStatus(401);
  const { userId } = await params;
  const obj = await getAvatarObject(ctx, userId);
  if (!obj) return plainStatus(404);
  return photoResponse(obj.body);
}

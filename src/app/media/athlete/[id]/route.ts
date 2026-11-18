import { getSessionContext } from "@/lib/dal/context";
import { getAthletePhotoObject } from "@/lib/dal/photos";
import { photoResponse, plainStatus } from "@/app/media/response";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) return plainStatus(401);
  const { id } = await params;
  const obj = await getAthletePhotoObject(ctx, id);
  // Same 404 for "no such athlete", "no access" and "no photo": existence is never leaked.
  if (!obj) return plainStatus(404);
  return photoResponse(obj.body);
}

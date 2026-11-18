import { PhotoAvatar } from "@/components/photos/photo-avatar";

export function UserAvatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  return <PhotoAvatar name={name} src={src} size={size === "sm" ? "sm" : size === "lg" ? "lg" : "md"} />;
}

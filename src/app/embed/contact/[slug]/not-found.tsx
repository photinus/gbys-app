import { FormUnavailable } from "@/components/contact-public/unavailable";
import { EmbedResizer } from "@/components/contact-public/embed-resizer";

export default function EmbedContactNotFound() {
  return (
    <EmbedResizer>
      <div className="p-3">
        <FormUnavailable compact title="This form isn't available" />
      </div>
    </EmbedResizer>
  );
}

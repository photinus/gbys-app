"use client";
import { useState } from "react";
import { Button, Modal, Sheet, useToast } from "@/components/ui";
export default function Demo() {
  const [m, setM] = useState(false); const [s, setS] = useState(false); const toast = useToast();
  return (<div className="mt-4 flex gap-2">
    <Button id="om" onClick={() => setM(true)}>Modal</Button>
    <Button id="os" onClick={() => setS(true)}>Sheet</Button>
    <Button id="ot" onClick={() => toast.success("Saved", "ok")}>Toast</Button>
    <Modal open={m} onClose={() => setM(false)} title="Add athlete" description="desc" footer={<Button onClick={() => setM(false)}>Save</Button>}>body</Modal>
    <Sheet open={s} onClose={() => setS(false)} title="Detail" subtitle="sub" footer={<Button>Go</Button>}>body</Sheet>
  </div>);
}

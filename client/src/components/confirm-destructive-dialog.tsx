import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmWord: string;
  onConfirm: () => void;
  isPending?: boolean;
  variant?: "destructive";
}

export function ConfirmDestructiveDialog({
  trigger,
  title,
  description,
  confirmWord,
  onConfirm,
  isPending,
}: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const matches = input === confirmWord;

  return (
    <AlertDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setInput(""); }}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <Input
            placeholder={`Type ${confirmWord} to confirm`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            data-testid="input-confirm-word"
            autoComplete="off"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-confirm-cancel">Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!matches || isPending}
            onClick={() => { onConfirm(); setOpen(false); setInput(""); }}
            data-testid="button-confirm-destructive"
          >
            {confirmWord}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MessageReplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  messageName: string;
  messageEmail: string;
  messageContent: string;
  onReplyAdded: () => void;
}

const MessageReplyDialog = ({
  open,
  onOpenChange,
  messageId,
  messageName,
  messageEmail,
  messageContent,
  onReplyAdded,
}: MessageReplyDialogProps) => {
  const [replyText, setReplyText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmitReply = async () => {
    if (!replyText.trim()) {
      toast.error("Please enter a reply message");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to reply");
        return;
      }

      const { error } = await supabase.from("message_replies").insert({
        message_id: messageId,
        admin_user_id: user.id,
        reply_text: replyText,
      });

      if (error) throw error;

      toast.success("Reply sent successfully!");
      setReplyText("");
      onOpenChange(false);
      onReplyAdded();
    } catch (error: any) {
      console.error("Error sending reply:", error);
      toast.error(error.message || "Failed to send reply");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reply to Message</DialogTitle>
          <DialogDescription>
            Send a reply to {messageName || "User"} ({messageEmail})
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-sm text-muted-foreground mb-2">Original Message:</p>
            <p className="text-sm">{messageContent}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Your Reply</label>
            <Textarea
              placeholder="Type your reply here..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={6}
              className="resize-none"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitReply}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Sending..." : "Send Reply"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MessageReplyDialog;

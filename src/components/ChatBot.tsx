import { useState } from "react";
import { MessageCircle, X, Send, Smile, Paperclip, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

interface Message {
  id: number;
  text: string;
  sender: "user" | "bot";
  timestamp: Date;
}

const ChatBot = () => {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      text: t("chatbotTitle"),
      sender: "bot",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const quickReplies = [
    "What is HubdexPay?",
    "How do I integrate the API?",
  ];

  const toggleChat = () => {
    setIsOpen(!isOpen);
  };

  const sendMessage = async () => {
    if (inputMessage.trim() && !isLoading) {
      const newMessage: Message = {
        id: messages.length + 1,
        text: inputMessage,
        sender: "user",
        timestamp: new Date(),
      };
      setMessages([...messages, newMessage]);
      
      // Save to database
      try {
        await supabase
          .from("chat_messages")
          .insert({
            message: inputMessage,
          });
      } catch (error: any) {
        console.error("Error saving message:", error);
      }
      
      const userInput = inputMessage;
      setInputMessage("");
      setIsLoading(true);

      // Get AI response
      try {
        const { data, error } = await supabase.functions.invoke('chat-ai', {
          body: {
            messages: [
              ...messages.map(m => ({
                role: m.sender === "user" ? "user" : "assistant",
                content: m.text
              })),
              {
                role: "user",
                content: userInput
              }
            ]
          }
        });

        if (error) throw error;

        const aiResponse = data.choices?.[0]?.message?.content || "Sorry, I couldn't process that. Please try again.";
        
        const botResponse: Message = {
          id: messages.length + 2,
          text: aiResponse,
          sender: "bot",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, botResponse]);
      } catch (error: any) {
        console.error("AI Error:", error);
        toast.error("Failed to get response. Please try again.");
        const errorResponse: Message = {
          id: messages.length + 2,
          text: "I'm having trouble connecting right now. Please try again in a moment.",
          sender: "bot",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorResponse]);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleQuickReply = (reply: string) => {
    setInputMessage(reply);
  };

  return (
    <>
      {/* Chat Button */}
      <button
        onClick={toggleChat}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary hover:bg-primary-dark text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center group hover:scale-110"
        aria-label="Open chat"
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <MessageCircle className="w-6 h-6 group-hover:animate-bounce" />
        )}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[600px] bg-background rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden animate-slide-up">
          {/* Header */}
          <div className="bg-gradient-to-r from-primary to-primary-dark text-primary-foreground p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                <MessageCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">{t("chatbotTitle")}</h3>
                <p className="text-xs text-primary-foreground/80">We're here to help</p>
              </div>
            </div>
            <button
              onClick={toggleChat}
              className="hover:bg-primary-foreground/10 rounded-full p-2 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/20">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.sender === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                    message.sender === "user"
                      ? "bg-primary text-primary-foreground ml-auto"
                      : "bg-background border border-border"
                  }`}
                >
                  <p className="text-sm">{message.text}</p>
                </div>
              </div>
            ))}

            {/* New messages indicator */}
            {messages.length > 1 && (
              <div className="text-center">
                <span className="text-xs text-muted-foreground bg-background px-3 py-1 rounded-full border border-border">
                  New messages
                </span>
              </div>
            )}
          </div>

          {/* Quick Replies */}
          <div className="px-4 py-2 border-t border-border bg-background">
            <div className="flex gap-2">
              {quickReplies.map((reply, index) => (
                <button
                  key={index}
                  onClick={() => handleQuickReply(reply)}
                  className="px-4 py-2 rounded-full border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-all text-sm font-medium"
                >
                  {reply}
                </button>
              ))}
            </div>
          </div>

          {/* Footer Message */}
          <div className="px-4 py-2 bg-muted/30 text-center">
            <p className="text-xs text-muted-foreground">
              Earn 3000 Birr simply by leveraging your personal network.
            </p>
          </div>

          {/* Input */}
          <div className="p-4 border-t border-border bg-background">
            <div className="flex items-center gap-2">
              <button className="text-muted-foreground hover:text-foreground transition-colors">
                <Paperclip className="w-5 h-5" />
              </button>
              <Input
                type="text"
                placeholder={t("chatbotPlaceholder")}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && !isLoading && sendMessage()}
                className="flex-1 border-none bg-muted/50 focus-visible:ring-1 focus-visible:ring-primary"
                disabled={isLoading}
              />
              <button className="text-muted-foreground hover:text-foreground transition-colors">
                <Smile className="w-5 h-5" />
              </button>
              <Button
                onClick={sendMessage}
                size="icon"
                className="bg-primary hover:bg-primary-dark"
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatBot;

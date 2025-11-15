import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Building2 } from "lucide-react";

const WelcomeNotice = () => {
  const [open, setOpen] = useState(false);
  const { language } = useLanguage();

  useEffect(() => {
    const hasSeenNotice = localStorage.getItem("hubdexpay-notice-seen");
    if (!hasSeenNotice) {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem("hubdexpay-notice-seen", "true");
    setOpen(false);
  };

  const content = {
    en: {
      title: "Welcome to HubdexPay",
      notice: "Important Notice",
      message: [
        "HubdexPay Ltd is currently operating using Nebdex payment software technology.",
        "This website is powered by the nebdex.com domain infrastructure to provide you with secure and reliable payment services.",
        "Please note: If you attempt to register directly on nebdex.com, you will need to complete your registration through our HubdexPay platform instead.",
        "All customer accounts, transactions, and services are managed exclusively through HubdexPay Ltd for your security and convenience."
      ],
      button: "I Understand"
    },
    ar: {
      title: "مرحباً بكم في HubdexPay",
      notice: "إشعار هام",
      message: [
        "تعمل شركة HubdexPay Ltd حالياً باستخدام تقنية برنامج الدفع Nebdex.",
        "يتم تشغيل هذا الموقع من خلال البنية التحتية لنطاق nebdex.com لتزويدك بخدمات دفع آمنة وموثوقة.",
        "يرجى ملاحظة: إذا حاولت التسجيل مباشرة على nebdex.com، فستحتاج إلى إكمال تسجيلك من خلال منصة HubdexPay الخاصة بنا بدلاً من ذلك.",
        "تتم إدارة جميع حسابات العملاء والمعاملات والخدمات حصرياً من خلال HubdexPay Ltd لضمان أمانك وراحتك."
      ],
      button: "فهمت"
    }
  };

  const t = content[language];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-4">
          <div className="flex items-center justify-center mb-2">
            <div className="p-3 rounded-full bg-primary/10">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-2xl text-center font-bold">
            {t.title}
          </DialogTitle>
          <div className="px-2 py-1 bg-primary/5 rounded-md border border-primary/20">
            <p className="text-sm font-semibold text-center text-primary">
              {t.notice}
            </p>
          </div>
        </DialogHeader>
        <DialogDescription asChild>
          <div className="space-y-4 text-base leading-relaxed">
            {t.message.map((paragraph, index) => (
              <p key={index} className="text-foreground">
                {paragraph}
              </p>
            ))}
          </div>
        </DialogDescription>
        <div className="flex justify-center mt-6">
          <Button 
            onClick={handleClose}
            size="lg"
            className="min-w-[200px]"
          >
            {t.button}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WelcomeNotice;

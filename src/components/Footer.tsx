import { Facebook, Twitter, Linkedin, Instagram } from "lucide-react";
import { Link } from "react-router-dom";
import logo from "@/assets/hubdexpay-logo-green.png";
import { useLanguage } from "@/contexts/LanguageContext";

const Footer = () => {
  const { t } = useLanguage();
  
  return (
    <footer className="bg-muted/30 border-t border-border py-12">
      <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div className="space-y-4">
            <Link to="/" className="flex items-center hover:opacity-80 transition-opacity">
              <img src={logo} alt="HubdexPay Logo" className="h-20 w-auto" />
            </Link>
            <p className="text-muted-foreground text-sm max-w-xs">
              {t("footerTagline")}
            </p>
          </div>
          
          <div>
            <h3 className="font-semibold text-foreground mb-4">{t("quickLinks")}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link to="/about" className="hover:text-primary transition-colors">{t("about")}</Link></li>
              <li><Link to="/services" className="hover:text-primary transition-colors">{t("services")}</Link></li>
              <li><Link to="/pricing" className="hover:text-primary transition-colors">{t("pricing")}</Link></li>
              <li><Link to="/news" className="hover:text-primary transition-colors">{t("news")}</Link></li>
              <li><Link to="/contact" className="hover:text-primary transition-colors">{t("contact")}</Link></li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-semibold text-foreground mb-4">{t("legal")}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">{t("becomeMerchant")}</a></li>
              <li><Link to="/api-docs" className="hover:text-primary transition-colors">{t("api")}</Link></li>
              <li><a href="#" className="hover:text-primary transition-colors">{t("privacyPolicy")}</a></li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-semibold text-foreground mb-4">{t("followUs")}</h3>
            <div className="flex gap-3">
              <a href="#" className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary hover:bg-primary hover:text-primary-foreground transition-all">
                <Facebook className="w-5 h-5" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary hover:bg-primary hover:text-primary-foreground transition-all">
                <Twitter className="w-5 h-5" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary hover:bg-primary hover:text-primary-foreground transition-all">
                <Linkedin className="w-5 h-5" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary hover:bg-primary hover:text-primary-foreground transition-all">
                <Instagram className="w-5 h-5" />
              </a>
            </div>
          </div>
        </div>
        
        <div className="border-t border-border pt-8 text-center text-sm text-muted-foreground">
          <p>© 2025 HubdexPay Ltd. {t("allRightsReserved")}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

import { Button } from "@/components/ui/button";

const Header = () => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-2xl font-bold text-primary-foreground">H</span>
            </div>
            <span className="text-xl font-bold text-foreground">
              HUBDEX <span className="text-primary">PAY</span>
            </span>
          </div>
          
          <nav className="hidden md:flex items-center gap-8">
            <a href="#home" className="text-foreground hover:text-primary transition-colors">
              Home
            </a>
            <a href="#services" className="text-foreground hover:text-primary transition-colors">
              Services
            </a>
            <a href="#about" className="text-foreground hover:text-primary transition-colors">
              About
            </a>
            <a href="#contact" className="text-foreground hover:text-primary transition-colors">
              Contact
            </a>
          </nav>
          
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              asChild
              className="hover:text-primary"
            >
              <a href="https://nebdex.com/login" target="_blank" rel="noopener noreferrer">
                Login
              </a>
            </Button>
            <Button 
              className="bg-primary hover:bg-primary-dark text-primary-foreground shadow-[var(--shadow-soft)] transition-all hover:shadow-[var(--shadow-strong)]"
              asChild
            >
              <a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer">
                Become a Merchant
              </a>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;

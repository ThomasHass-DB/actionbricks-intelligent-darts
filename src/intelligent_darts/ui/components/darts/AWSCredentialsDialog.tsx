import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Key, Lock, Globe, AlertCircle } from "lucide-react";

interface AWSCredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (credentials: {
    access_key_id: string;
    secret_access_key: string;
    session_token?: string;
    region: string;
  }) => Promise<void>;
}

export function AWSCredentialsDialog({
  open,
  onOpenChange,
  onConnect,
}: AWSCredentialsDialogProps) {
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!accessKeyId || !secretAccessKey) {
      setError("Please fill in all required fields");
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      await onConnect({
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
        session_token: sessionToken || undefined,
        region,
      });
      
      // Close dialog on success
      onOpenChange(false);
      
      // Clear sensitive data
      setAccessKeyId("");
      setSecretAccessKey("");
      setSessionToken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCancel = () => {
    setAccessKeyId("");
    setSecretAccessKey("");
    setSessionToken("");
    setRegion("us-east-1");
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            AWS Credentials
          </DialogTitle>
          <DialogDescription>
            Enter your AWS credentials to connect to the Kinesis WebRTC stream.
            Your credentials are stored securely in the server session.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="access-key-id" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              AWS Access Key ID
            </Label>
            <Input
              id="access-key-id"
              type="text"
              placeholder="AKIAIOSFODNN7EXAMPLE" // gitleaks:allow
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              disabled={isConnecting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-access-key" className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              AWS Secret Access Key
            </Label>
            <Input
              id="secret-access-key"
              type="password"
              placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
              disabled={isConnecting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="session-token" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              AWS Session Token (optional)
            </Label>
            <Input
              id="session-token"
              type="password"
              placeholder="Session token (for temporary credentials)"
              value={sessionToken}
              onChange={(e) => setSessionToken(e.target.value)}
              disabled={isConnecting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="region" className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              AWS Region
            </Label>
            <Input
              id="region"
              type="text"
              placeholder="us-east-1"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              disabled={isConnecting}
            />
          </div>

          <div className="text-xs text-muted-foreground space-y-1 pt-2">
            <p>• Signaling Channel: actionbricks_demo_darts</p>
            <p>• Your credentials are never stored permanently</p>
            <p>• The connection is encrypted end-to-end</p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isConnecting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? "Connecting..." : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

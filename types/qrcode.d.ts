declare module "qrcode" {
  type ToDataURLOpts = {
    margin?: number;
    width?: number;
  };

  const QRCode: {
    toDataURL: (text: string, opts?: ToDataURLOpts) => Promise<string>;
  };

  export default QRCode;
}


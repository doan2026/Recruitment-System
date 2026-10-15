declare module "pdfmake/build/pdfmake" {
  const pdfMake: {
    addVirtualFileSystem(fonts: Record<string, string>): void;
    createPdf(document: Record<string, unknown>): {
      getBlob(callback: (blob: Blob) => void): void;
    };
  };
  export default pdfMake;
}
declare module "pdfmake/build/vfs_fonts" {
  const fonts: Record<string, string>;
  export default fonts;
}

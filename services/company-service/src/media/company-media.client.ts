export enum CompanyMediaAssetType {
  COMPANY_LOGO = 'COMPANY_LOGO',
  COMPANY_IMAGE = 'COMPANY_IMAGE',
  COMPANY_VIDEO = 'COMPANY_VIDEO',
}

export const COMPANY_MEDIA_TYPES = [
  CompanyMediaAssetType.COMPANY_LOGO,
  CompanyMediaAssetType.COMPANY_IMAGE,
  CompanyMediaAssetType.COMPANY_VIDEO,
] as const;

export interface CompanyUploadCapability {
  readonly fileId: string;
  readonly uploadUrl: string;
  readonly cloudName: string;
  readonly apiKey: string;
  readonly resourceType: 'image' | 'video';
  readonly expiresAt: string;
  readonly maxBytes: number;
  readonly allowedFormats: readonly string[];
  readonly params: Readonly<Record<string, string | number>>;
  readonly signature: string;
}

export interface VerifiedCompanyFile {
  readonly id: string;
  readonly ownerType: 'COMPANY';
  readonly ownerId: string;
  readonly type: CompanyMediaAssetType;
  readonly status: 'ACTIVE';
  readonly originalFilename: string;
  readonly mimeType: string | null;
  readonly format: string | null;
  readonly bytes: number | null;
  readonly url: string;
  readonly privateDelivery: false;
  readonly aggregateVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CompanyFileReference {
  readonly id: string;
  readonly fileId: string;
  readonly callerService: 'company-service';
  readonly referenceType: string;
  readonly referenceId: string;
  readonly createdAt: string;
}

export abstract class CompanyMediaClient {
  abstract createCompanyUploadIntent(
    companyId: string,
    requestedBy: string,
    assetType: CompanyMediaAssetType,
    originalFilename: string,
    idempotencyKey?: string,
  ): Promise<CompanyUploadCapability>;

  abstract confirmCompanyFile(
    fileId: string,
    companyId: string,
    assetType: CompanyMediaAssetType,
  ): Promise<VerifiedCompanyFile>;

  abstract verifyCompanyFile(
    fileId: string,
    companyId: string,
    assetType: CompanyMediaAssetType,
  ): Promise<VerifiedCompanyFile>;

  abstract bindCompanyFile(
    fileId: string,
    companyId: string,
    assetType: CompanyMediaAssetType,
    referenceType: string,
    referenceId: string,
  ): Promise<CompanyFileReference>;

  abstract releaseReference(mediaReferenceUuid: string): Promise<void>;

  abstract deleteCompanyFile(
    fileId: string,
    companyId: string,
    assetType: CompanyMediaAssetType,
  ): Promise<void>;
}

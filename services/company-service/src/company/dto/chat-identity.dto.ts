import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class CompanyChatIdentityRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export interface CompanyChatIdentityDto {
  userId: string;
  companyId: string;
  name: string;
  avatarUrl: string | null;
}

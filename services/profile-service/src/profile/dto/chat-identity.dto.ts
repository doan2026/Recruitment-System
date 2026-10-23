import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ChatIdentityRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export interface ChatIdentityDto {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

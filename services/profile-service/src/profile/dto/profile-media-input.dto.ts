import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length } from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator';

export class AttachAvatarDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  fileId!: string;
}

export class CreateUploadedCvDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @Trim()
  @IsString()
  @Length(1, 160)
  title!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  fileId!: string;
}

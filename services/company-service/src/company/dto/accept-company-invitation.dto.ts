import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator';

export class AcceptCompanyInvitationDto {
  @ApiProperty({ minLength: 32, maxLength: 128 })
  @Trim()
  @IsString()
  @Length(32, 128)
  token!: string;
}

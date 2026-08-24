import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, IsUUID, MaxLength } from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator';

export class FileReferenceDto {
  @ApiProperty({
    format: 'uuid',
    description: 'File identifier returned by Media Service',
  })
  @IsUUID()
  fileId!: string;

  @ApiProperty({
    format: 'uri',
    description: 'Public URL returned by Media Service',
  })
  @Trim()
  @MaxLength(2048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url!: string;
}

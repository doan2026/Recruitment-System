import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class FileReferenceDto {
  @ApiProperty({
    format: 'uuid',
    description: 'File identifier returned by Media Service',
  })
  @IsUUID('4')
  fileId!: string;
}

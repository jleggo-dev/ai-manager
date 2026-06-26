import { createTheme, MantineColorsTuple } from '@mantine/core';

const navy: MantineColorsTuple = [
  '#E6EAF2',
  '#B3BDD6',
  '#8090BA',
  '#4D639E',
  '#1A3682',
  '#011B58',
  '#011850',
  '#011347',
  '#010F3B',
  '#010A2E',
];

const royal: MantineColorsTuple = [
  '#E6EAFF',
  '#B3BFFF',
  '#7F94FF',
  '#4C69FF',
  '#193EFF',
  '#0629D3',
  '#0524BE',
  '#041FA8',
  '#031A93',
  '#02157D',
];

const skyblue: MantineColorsTuple = [
  '#F5FCFF',
  '#E0F6FF',
  '#CBF0FF',
  '#ABE7FF',
  '#8BDDFF',
  '#6BD3FF',
  '#4BC9FF',
  '#2BBFFF',
  '#0BB5FF',
  '#009BE6',
];

const mint: MantineColorsTuple = [
  '#F4FFF7',
  '#E5FFED',
  '#CDFDDA',
  '#A8F5C0',
  '#83EDA6',
  '#5EE58C',
  '#39DD72',
  '#24C45C',
  '#1AA84E',
  '#108C40',
];

const coral: MantineColorsTuple = [
  '#FFF0F0',
  '#FFDADA',
  '#FFC0C0',
  '#FFA0A1',
  '#F87E80',
  '#F2555A',
  '#E03E43',
  '#CC2D32',
  '#B01D22',
  '#940D12',
];

const marigold: MantineColorsTuple = [
  '#FFF8E6',
  '#FFECB3',
  '#FFE080',
  '#FFD44D',
  '#FFC81A',
  '#FFA000',
  '#E69000',
  '#CC8000',
  '#B37000',
  '#996000',
];

const purple: MantineColorsTuple = [
  '#F0EAFA',
  '#D5C8F0',
  '#BAA6E6',
  '#9F84DC',
  '#8462D2',
  '#5326A5',
  '#4A2295',
  '#411E85',
  '#381A75',
  '#2F1665',
];

const theme = createTheme({
  primaryColor: 'royal',
  defaultRadius: 'lg',

  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  headings: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontWeight: '600',
  },

  colors: {
    navy,
    royal,
    skyblue,
    mint,
    coral,
    marigold,
    purple,
  },

  components: {
    Button: { defaultProps: { size: 'sm', radius: 'lg' } },
    TextInput: { defaultProps: { size: 'sm' } },
    Select: { defaultProps: { size: 'sm' } },
    Textarea: { defaultProps: { size: 'sm' } },
    Table: { defaultProps: { striped: true, highlightOnHover: true } },
  },
});

export default theme;

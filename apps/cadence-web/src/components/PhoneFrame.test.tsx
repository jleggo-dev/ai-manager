import { render, screen } from '@testing-library/react';
import { PhoneFrame } from './PhoneFrame.tsx';

describe('PhoneFrame', () => {
  it('renders the device chrome (status bar) alongside its children', () => {
    render(
      <PhoneFrame>
        <p>screen content</p>
      </PhoneFrame>,
    );

    expect(screen.getByText('9:41')).toBeInTheDocument();
    expect(screen.getByText('screen content')).toBeInTheDocument();
  });

  it('wraps children in the same frame on every render, without swallowing them', () => {
    const { container } = render(
      <PhoneFrame>
        <span data-testid="probe">probe</span>
      </PhoneFrame>,
    );

    const probe = screen.getByTestId('probe');
    expect(container.querySelector('.screen')?.contains(probe)).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { renderApp, mockApi } from './utils';
import { tokenStore } from '../lib/api';
import Landing, { DEMO_ROLES } from '../pages/Landing';
import Login from '../pages/Login';

beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear(); tokenStore.clear?.(); });
const Where = () => { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; };

describe('landing page', () => {
  it('has a visible Login button that goes to the login page, a page title, and a role card for every demo role', async () => {
    renderApp(<Routes><Route path="/" element={<><Landing /></>} /></Routes>);
    const logins = screen.getAllByRole('link', { name: /^Login/ }); expect(logins.length).toBeGreaterThanOrEqual(2);
    for (const l of logins) expect(l).toHaveAttribute('href', '/login');
    await waitFor(() => expect(document.title).toBe('Welcome · ApprovalFlow (demo)'));
    const roles = within(document.getElementById('roles')!).getAllByRole('link'); expect(roles).toHaveLength(DEMO_ROLES.length);
    expect(roles[0]).toHaveAttribute('href', '/login?role=institution'); expect(roles[1]).toHaveAttribute('href', '/login?role=regional-officer');
  });
  it('says plainly that it is a demonstration and that its illustration holds no real figures', () => {
    renderApp(<Landing />);
    expect(screen.getByText(/All records are synthetic/)).toBeInTheDocument(); expect(screen.getByText(/not an official AICTE service/)).toBeInTheDocument(); expect(screen.getByText(/Illustration only/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ApprovalFlow\s+Demonstration prototype/ })).toHaveAttribute('href', '/');
  });
  it('starts the sign-in with the chosen role filled in, and tells the user what to press next', async () => {
    renderApp(<Routes><Route path="/login" element={<Login />} /></Routes>, '/login?role=regional-officer');
    expect(await screen.findByDisplayValue('ro.nr@demo.local')).toBeInTheDocument(); expect(screen.getByDisplayValue('Demo@1234')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Details filled in for Regional officer. Press Sign in to continue.');
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeVisible(); expect(screen.getByRole('link', { name: /Back to home/ })).toHaveAttribute('href', '/');
  });
  it('leaves the form empty when no role is chosen, and fills it when a role card on the login page is clicked', async () => {
    renderApp(<Login />, '/login'); expect(await screen.findByLabelText('Email address')).toHaveValue(''); expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Institution/ }));
    expect(screen.getByLabelText('Email address')).toHaveValue('inst1@demo.local'); expect(screen.getByRole('status')).toHaveTextContent('Institution');
  });
  it('shows a clear error and keeps the typed email when the server refuses the sign-in', async () => {
    mockApi({ '/api/auth/login': () => [401, { error: { code: 'UNAUTHENTICATED', message: 'Email or password is incorrect' } }] });
    renderApp(<Login />, '/login'); await userEvent.type(await screen.findByLabelText('Email address'), 'x@demo.local'); await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(await screen.findByText('Email or password is incorrect')).toBeInTheDocument(); expect(screen.getByLabelText('Email address')).toHaveValue('x@demo.local');
  });
  void Where;
});

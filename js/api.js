export async function getClientsServer(clientId = null) {
  try {
    const response = await fetch(clientId ? `http://localhost:3000/api/clients/${clientId}` : 'http://localhost:3000/api/clients');
    if (!response.ok) {
      throw new Error(`Failed to fetch client${clientId ? ` with ID ${clientId}` : 's'}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching clients:', error);
    return null;
  }
}

export async function addClientServer(client) {
  let response = await fetch('http://localhost:3000/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(client)
  });
  let data = await response.json();

  return data;
}

export async function updateClientServer(id, client) {
  let response = await fetch(`http://localhost:3000/api/clients/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(client)
  });
  let data = await response.json();

  return data;
}

export async function deleteClientServer(id) {
  let response = await fetch(`http://localhost:3000/api/clients/${id}`, {
    method: 'DELETE',
  });
  let data = await response.json();

  return data;
}

